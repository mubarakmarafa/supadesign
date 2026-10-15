import XCTest
import Foundation
import Darwin
@testable import RelayTunnelCore

private final class Fixture {
  let process = Process()
  let input = Pipe()
  let output = Pipe()
  var buffered = Data()
  var configuration: [String: String] = [:]
  init() throws {
    var repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    while !FileManager.default.fileExists(atPath: repo.appendingPathComponent("apps/server/src/bin.ts").path) && repo.path != "/" {
      repo.deleteLastPathComponent()
    }
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", "apps/server/src/relay/testing/nativeFixture.ts"]
    process.currentDirectoryURL = repo
    process.standardInput = input; process.standardOutput = output
    process.standardError = FileHandle.standardError
    try process.run()
    let result = try read()
    configuration = result.mapValues { $0 as! String }
  }
  func read() throws -> [String: Any] {
    while true {
      if let end = buffered.firstIndex(of: 10) {
        let line = Data(buffered.prefix(upTo: end)); buffered.removeFirst(end - buffered.startIndex + 1)
        if let result = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { return result }
      }
      let more = output.fileHandleForReading.availableData
      guard !more.isEmpty else { throw RelayError.invalid("Fixture exited") }
      buffered.append(more)
    }
  }
  func command(_ op: String) throws -> [String: Any] {
    try input.fileHandleForWriting.write(contentsOf: Data("{\"op\":\"\(op)\"}\n".utf8))
    return try read()
  }
  func stop() {
    try? input.fileHandleForWriting.write(contentsOf: Data("{\"op\":\"stop\"}\n".utf8))
    try? input.fileHandleForWriting.close()
    process.waitUntilExit()
  }
}

private func cpuSeconds() -> Double {
  var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
  return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
}

private func rejectedUpgrade(origin: String) throws -> Data {
  let url = try XCTUnwrap(URL(string: origin))
  let port = try XCTUnwrap(url.port)
  let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
  guard socket >= 0 else { throw POSIXError(.EIO) }
  defer { Darwin.close(socket) }
  var timeout = timeval(tv_sec: 5, tv_usec: 0)
  setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
  var noSignal: Int32 = 1
  setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
  var address = sockaddr_in()
  address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  address.sin_family = sa_family_t(AF_INET)
  address.sin_port = UInt16(port).bigEndian
  address.sin_addr.s_addr = inet_addr("127.0.0.1")
  let connected = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      Darwin.connect(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  guard connected == 0 else { throw POSIXError(.ECONNREFUSED) }
  let request = Data((
    "GET /.well-known/supaterm/environment HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nUpgrade: websocket\r\n\r\n" +
    "GET /api/test/site/style.css HTTP/1.1\r\nHost: elsewhere.invalid\r\nConnection: close\r\n\r\n"
  ).utf8)
  try request.withUnsafeBytes { bytes in
    var offset = 0
    while offset < bytes.count {
      let count = Darwin.write(socket, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
      guard count > 0 else { throw POSIXError(.EIO) }
      offset += count
    }
  }
  var response = Data()
  var bytes = [UInt8](repeating: 0, count: 16384)
  while true {
    let count = Darwin.read(socket, &bytes, bytes.count)
    if count == 0 || (count < 0 && errno == ECONNRESET) { return response }
    guard count > 0 else { throw POSIXError(.EIO) }
    response.append(contentsOf: bytes.prefix(count))
  }
}

final class InteropTests: XCTestCase {
  func testGoRelayAndNodeHost() async throws {
    guard ProcessInfo.processInfo.environment["SUPATERM_RELAY_E2E"] == "1" else {
      throw XCTSkip("Set SUPATERM_RELAY_E2E=1 and RELAY_TEST_BINARY to the compiled Go relay")
    }
    let fixture = try Fixture(); defer { fixture.stop() }
    FileHandle.standardError.write(Data("CHECKPOINT fixture ready\n".utf8))
    let config = fixture.configuration
    let tunnel = try RelayTunnel(relayURL: config["relayUrl"]!, hostAddress: config["address"]!)
    let origin = try await tunnel.start(port: 0)
    let authOrigin = origin
    let sessionConfig = URLSessionConfiguration.ephemeral
    sessionConfig.httpMaximumConnectionsPerHost = 32
    sessionConfig.timeoutIntervalForRequest = 30
    let session = URLSession(configuration: sessionConfig)
    do {
      let coldStart = Date()
      try await withThrowingTaskGroup(of: Void.self) { group in
        for _ in 0..<20 {
          group.addTask {
            let (_, response) = try await session.data(from: URL(string: authOrigin + "/.well-known/supaterm/environment")!)
            XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
          }
        }
        try await group.waitForAll()
      }
      let (descriptor, descriptorResponse) = try await session.data(from: URL(string: authOrigin + "/.well-known/supaterm/environment")!)
      XCTAssertEqual((descriptorResponse as! HTTPURLResponse).statusCode, 200)
      XCTAssertNotNil((try JSONSerialization.jsonObject(with: descriptor) as! [String: Any])["environmentId"])
      print("METRIC cold_descriptor_ms=\(Date().timeIntervalSince(coldStart) * 1000)")
      let token = URLComponents(string: config["pairingUrl"]!)!.fragment!.split(separator: "=").last!
      var exchange = URLRequest(url: URL(string: authOrigin + "/oauth/token")!)
      exchange.httpMethod = "POST"; exchange.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      exchange.httpBody = Data("grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=\(token)&subject_token_type=urn:supaterm:params:oauth:token-type:environment-bootstrap&requested_token_type=urn:ietf:params:oauth:token-type:access_token&client_label=native-ios-interop".utf8)
      let (accessData, accessResponse) = try await session.data(for: exchange)
      XCTAssertEqual((accessResponse as! HTTPURLResponse).statusCode, 200)
      let access = try JSONSerialization.jsonObject(with: accessData) as! [String: Any]
      let bearer = try XCTUnwrap(access["access_token"] as? String)
      var auth = URLRequest(url: URL(string: authOrigin + "/api/auth/session")!)
      auth.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
      let (_, authResponse) = try await session.data(for: auth)
      XCTAssertEqual((authResponse as! HTTPURLResponse).statusCode, 200)
      var ticketRequest = URLRequest(url: URL(string: authOrigin + "/api/auth/websocket-ticket")!)
      ticketRequest.httpMethod = "POST"; ticketRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
      let (ticketData, _) = try await session.data(for: ticketRequest)
      let ticket = (try JSONSerialization.jsonObject(with: ticketData) as! [String: Any])["ticket"] as! String
      let actualWS = session.webSocketTask(with: URL(string: authOrigin.replacingOccurrences(of: "http:", with: "ws:") + "/ws?wsTicket=\(ticket)&orchestrationProtocol=2")!)
      actualWS.resume()
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        actualWS.sendPing { error in
          if let error { continuation.resume(throwing: error) } else { continuation.resume() }
        }
      }
      FileHandle.standardError.write(Data("CHECKPOINT auth and inner /ws passed\n".utf8))
      actualWS.cancel(with: .normalClosure, reason: nil)

      for base in [origin, config["nodeOrigin"]!] {
        let rejected = try rejectedUpgrade(origin: base)
        XCTAssertFalse(String(decoding: rejected, as: UTF8.self).contains("width:123px"))
        let (_, healthy) = try await session.data(from: URL(string: base + "/.well-known/supaterm/environment")!)
        XCTAssertEqual((healthy as! HTTPURLResponse).statusCode, 200)
      }
      FileHandle.standardError.write(Data("CHECKPOINT rejected upgrade and sibling HTTP passed\n".utf8))

      let (image, imageResponse) = try await session.data(from: URL(string: origin + config["image"]!)!)
      XCTAssertEqual((imageResponse as! HTTPURLResponse).statusCode, 200)
      XCTAssertEqual(image.prefix(8), Data([137, 80, 78, 71, 13, 10, 26, 10]))
      let htmlURL = URL(string: origin + config["html"]!)!
      let (html, _) = try await session.data(from: htmlURL)
      XCTAssertTrue(String(decoding: html, as: UTF8.self).contains("style.css"))
      for sibling in ["style.css", "app.js", "img/logo.png"] {
        let (data, response) = try await session.data(from: URL(string: sibling, relativeTo: htmlURL)!)
        XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200); XCTAssertFalse(data.isEmpty)
      }
      var range = URLRequest(url: URL(string: origin + config["video"]!)!)
      range.setValue("bytes=1000-2999999", forHTTPHeaderField: "Range")
      let (video, response) = try await session.data(for: range)
      XCTAssertEqual((response as! HTTPURLResponse).statusCode, 206)
      XCTAssertEqual(video.count, 2_999_000)
      XCTAssertEqual((response as! HTTPURLResponse).value(forHTTPHeaderField: "Content-Range"), "bytes 1000-2999999/20971520")

      for route in ["/ws", "/api/device-hub/vendor/serve-sim/helper/ws?wsTicket=spike-ticket"] {
        let socket = session.webSocketTask(with: URL(string: origin.replacingOccurrences(of: "http:", with: "ws:") + route)!)
        socket.resume()
        let ping = Data([9, 8, 7]); try await socket.send(.data(ping))
        var echoed = false
        for _ in 0..<30 {
          let message = try await socket.receive()
          if case .data(let data) = message, data == ping { echoed = true; break }
        }
        XCTAssertTrue(echoed); socket.cancel(with: .normalClosure, reason: nil)
      }
      FileHandle.standardError.write(Data("CHECKPOINT assets and device WS passed\n".utf8))
      let mjpeg = URL(string: origin + "/api/device-hub/vendor/serve-sim/helper/sim-1/stream.mjpeg?wsTicket=spike-ticket")!
      let progressiveStart = Date()
      let (bytes, mjpegResponse) = try await session.bytes(from: mjpeg)
      XCTAssertEqual((mjpegResponse as! HTTPURLResponse).statusCode, 200)
      var rolling = Data(); var frames = 0; var firstFrameMs = 0.0
      for try await byte in bytes {
        rolling.append(byte)
        if rolling.suffix(2) == Data([0xff, 0xd8]) {
          frames += 1
          if frames == 1 { firstFrameMs = Date().timeIntervalSince(progressiveStart) * 1000 }
          if frames == 10 { break }
        }
        if rolling.count > 256 { rolling.removeFirst(128) }
      }
      bytes.task.cancel()
      XCTAssertEqual(frames, 10)
      print("METRIC mjpeg_frames=\(frames) first_frame_ms=\(firstFrameMs) tenth_frame_ms=\(Date().timeIntervalSince(progressiveStart) * 1000)")
      FileHandle.standardError.write(Data("CHECKPOINT MJPEG passed\n".utf8))
      let concurrencyStart = Date()
      try await withThrowingTaskGroup(of: Void.self) { group in
        for _ in 0..<20 {
          group.addTask {
            let (data, response) = try await session.data(from: URL(string: origin + config["image"]!)!)
            XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200); XCTAssertEqual(data, image)
          }
        }
        try await group.waitForAll()
      }
      print("METRIC concurrent_requests=20 elapsed_ms=\(Date().timeIntervalSince(concurrencyStart) * 1000)")
      FileHandle.standardError.write(Data("CHECKPOINT concurrency passed\n".utf8))
      _ = try await session.data(from: URL(string: config["nodeOrigin"]! + config["image"]!)!)
      for (name, base) in [("swift", origin), ("node", config["nodeOrigin"]!)] {
        for direction in ["down", "up"] {
          let nodeBefore = name == "node" ? try fixture.command("nodeCPU") : [:]
          let files = FileManager.default.temporaryDirectory.appendingPathComponent("native-relay-bench-" + UUID().uuidString)
          try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
          defer { try? FileManager.default.removeItem(at: files) }
          let bodyFile = files.appendingPathComponent("body")
          let uploadFile = files.appendingPathComponent("upload")
          if direction == "up" { try Data(repeating: 7, count: 20 * 1024 * 1024).write(to: uploadFile) }
          let curl = Process(); let metricsPipe = Pipe()
          curl.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
          curl.arguments = ["--silent", "--show-error", "--fail", "--max-time", "30", "--noproxy", "*", "-H", "Authorization: Bearer fixture-bearer", "-H", "Expect:", "-o", bodyFile.path, "-w", "%{json}"] +
            (direction == "up" ? ["-X", "POST", "--data-binary", "@" + uploadFile.path] : []) +
            [base + (direction == "down" ? "/api/test/blob" : "/api/test/upload")]
          curl.standardOutput = metricsPipe; curl.standardError = FileHandle.standardError
          let doorwayCPUStart = cpuSeconds()
          try curl.run()
          let metricsData = metricsPipe.fileHandleForReading.readDataToEndOfFile()
          curl.waitUntilExit()
          var cpu = cpuSeconds() - doorwayCPUStart
          XCTAssertEqual(curl.terminationStatus, 0)
          let metrics = try JSONSerialization.jsonObject(with: metricsData) as! [String: Any]
          let elapsed = metrics["time_total"] as! Double
          let ttfb = (metrics["time_starttransfer"] as! Double) * 1000
          let received = try Data(contentsOf: bodyFile)
          XCTAssertEqual(metrics["http_code"] as! Int, 200)
          if direction == "down" { XCTAssertEqual(received.count, 20 * 1024 * 1024); XCTAssertTrue(received.allSatisfy { $0 == 7 }) }
          else { XCTAssertEqual(String(decoding: received, as: UTF8.self), "20971520") }
          if name == "node" {
            let after = try fixture.command("nodeCPU")
            cpu = (Double(after["user"] as! Int) + Double(after["system"] as! Int) - Double(nodeBefore["user"] as! Int) - Double(nodeBefore["system"] as! Int)) / 1_000_000
          }
          print("METRIC \(name)_\(direction) mib_s=\(20 / elapsed) cpu_s=\(cpu) cpu_percent=\(cpu / elapsed * 100) ttfb_ms=\(ttfb)")
        }
      }
      let relayRestart = Date(); _ = try fixture.command("restartRelay")
      let (afterRelay, _) = try await session.data(from: URL(string: origin + config["image"]!)!)
      XCTAssertEqual(afterRelay, image)
      print("METRIC relay_restart_recovery_ms=\(Date().timeIntervalSince(relayRestart) * 1000)")
      let hostRestart = Date(); _ = try fixture.command("restartHost")
      let (_, afterHost) = try await session.data(for: auth)
      XCTAssertEqual((afterHost as! HTTPURLResponse).statusCode, 200)
      print("METRIC host_restart_recovery_ms=\(Date().timeIntervalSince(hostRestart) * 1000)")
      tunnel.suspend()
      let resumedOrigin = try await tunnel.resume()
      XCTAssertEqual(resumedOrigin, origin)
      let (afterForeground, _) = try await session.data(from: URL(string: origin + config["image"]!)!)
      XCTAssertEqual(afterForeground, image)
      print("METRIC foreground_rebind=passed origin=\(origin)")
    } catch {
      session.invalidateAndCancel(); await tunnel.stop(); throw error
    }
    session.invalidateAndCancel(); await tunnel.stop()
  }
}
