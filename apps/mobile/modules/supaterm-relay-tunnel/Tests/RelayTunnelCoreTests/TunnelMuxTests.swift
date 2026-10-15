import XCTest
@testable import RelayTunnelCore

struct MuxFrameValue: Equatable {
  let type: MuxFrame
  let id: UInt32
  let payload: Data
  init(_ type: MuxFrame, _ id: UInt32, _ payload: Data = Data()) {
    self.type = type; self.id = id; self.payload = payload
  }
}

func decodeFrames(_ plain: Data) throws -> [MuxFrameValue] {
  var frames: [MuxFrameValue] = []
  var offset = 0
  while offset < plain.count {
    let length = Int(plain.uint32(at: offset + 5))
    let type = try XCTUnwrap(MuxFrame(rawValue: plain[plain.startIndex + offset]))
    let start = plain.startIndex + offset + 9
    frames.append(MuxFrameValue(type, plain.uint32(at: offset + 1), plain.subdata(in: start..<(start + length))))
    offset += 9 + length
  }
  return frames
}

private final class RemoteSender {
  let mux = TunnelMux()
  var credit = sessionWindow
  var grants: [Int] = []

  init(streams: [UInt32]) throws {
    for id in streams { mux.open(id) }
    try flush()
  }

  func send(_ parts: [(UInt32, Int)]) throws -> [MuxEvent] {
    let bytes = parts.reduce(0) { $0 + $1.1 }
    credit -= max(bytes, minimumCost)
    let events = try mux.receive(parts.reduce(Data()) { $0 + TunnelMux.frame(.data, $1.0, Data(repeating: 7, count: $1.1)) })
    try flush()
    return events
  }

  func stream(_ id: UInt32, bytes: Int, consume: Bool) throws {
    var sent = 0
    while sent < bytes {
      let count = min(60_000, bytes - sent)
      for case .data(let id, let payload) in try send([(id, count)]) where consume {
        mux.consumed(id, bytes: payload.count)
      }
      try flush()
      sent += count
    }
  }

  func stall(_ streams: [UInt32], bytes: Int) throws {
    for id in streams { try stream(id, bytes: bytes, consume: false) }
  }

  func flush() throws {
    while let record = mux.nextRecord() {
      for frame in try decodeFrames(record.plain) where frame.type == .window && frame.id == 0 {
        let bytes = Int(frame.payload.uint32(at: 0))
        credit += bytes; grants.append(bytes)
      }
    }
  }
}

final class TunnelMuxTests: XCTestCase {
  func testPingIsAnsweredWithPong() throws {
    let mux = TunnelMux()
    XCTAssertEqual(try mux.receive(TunnelMux.frame(.ping, 0)), [])
    XCTAssertEqual(try decodeFrames(XCTUnwrap(mux.nextRecord()).plain), [MuxFrameValue(.pong, 0)])
    XCTAssertEqual(try mux.receive(TunnelMux.frame(.pong, 0)), [])
    XCTAssertNil(mux.nextRecord())
    for invalid in [TunnelMux.frame(.ping, 1), TunnelMux.frame(.ping, 0, Data([0])),
                    TunnelMux.frame(.pong, 1), TunnelMux.frame(.pong, 0, Data([0]))] {
      XCTAssertThrowsError(try TunnelMux().receive(invalid))
    }
  }

  func testKeepaliveClosesAfterThreeSilentTicks() throws {
    let mux = TunnelMux()
    try mux.tick()
    XCTAssertEqual(try decodeFrames(XCTUnwrap(mux.nextRecord()).plain), [MuxFrameValue(.ping, 0)])
    _ = try mux.receive(TunnelMux.frame(.pong, 0))
    try mux.tick()
    XCTAssertNil(mux.nextRecord())
    try mux.tick()
    try mux.tick()
    XCTAssertEqual(try decodeFrames(XCTUnwrap(mux.nextRecord()).plain), [MuxFrameValue(.ping, 0), MuxFrameValue(.ping, 0)])
    XCTAssertThrowsError(try mux.tick())
  }

  func testConsumedBytesReturnWhileStalledStreamsHoldMostOfTheSessionWindow() throws {
    let remote = try RemoteSender(streams: [1, 3, 5, 7, 9])
    try remote.stall([1, 3, 5, 7], bytes: 1_800_000)
    XCTAssertEqual(remote.credit, sessionWindow - 7_200_000)
    XCTAssertEqual(remote.grants, [])
    var delivered = 0
    while delivered < 2 * sessionWindow {
      guard remote.credit >= minimumCost else { return XCTFail("Session window stalled after \(delivered) bytes") }
      for case .data(let id, let payload) in try remote.send([(9, min(60_000, remote.credit))]) {
        remote.mux.consumed(id, bytes: payload.count); delivered += payload.count
      }
      try remote.flush()
    }
    XCTAssertFalse(remote.grants.isEmpty)
    XCTAssertTrue(remote.grants.allSatisfy { $0 < sessionWindow / 4 })
  }

  func testMixedRecordReturnsOverheadAtOnceAndEachStreamsBytesIndependently() throws {
    let remote = try RemoteSender(streams: [1, 3, 5, 7, 9, 11])
    try remote.stall([1, 3, 5, 7], bytes: 1_800_000)
    let events = try remote.send([(9, 1_000), (11, 3_000)])
    XCTAssertEqual(remote.grants, [minimumCost - 4_000])
    XCTAssertEqual(events.count, 2)
    remote.mux.consumed(11, bytes: 3_000)
    try remote.flush()
    XCTAssertEqual(remote.grants, [minimumCost - 4_000, 3_000])
    remote.mux.close(9, reset: true)
    try remote.flush()
    XCTAssertEqual(remote.grants, [minimumCost - 4_000, 3_000, 1_000])
  }

  func testPendingGrantFlushesWhenFullRecordsDrainTheSessionWindow() throws {
    let remote = try RemoteSender(streams: [1, 3, 5, 7])
    try remote.stream(1, bytes: 2_060_000, consume: true)
    XCTAssertEqual(remote.grants, [])
    try remote.stall([3, 5, 7], bytes: streamWindow)
    guard remote.credit >= minimumCost else { return XCTFail("Session window stalled with \(remote.credit) bytes of credit") }
    XCTAssertEqual(try remote.send([(1, 60_000)]).count, 1)
  }

  func testStalledStreamSharingManySmallRecordsDoesNotPinTheirOverhead() throws {
    let remote = try RemoteSender(streams: [1, 3])
    var delivered = 0
    for _ in 0..<256 {
      guard remote.credit >= minimumCost else { return XCTFail("Session window stalled after \(delivered) bytes") }
      for case .data(3, let payload) in try remote.send([(1, 16), (3, 1_024)]) {
        remote.mux.consumed(3, bytes: payload.count); delivered += payload.count
      }
      try remote.flush()
    }
    XCTAssertEqual(delivered, 256 * 1_024)
    XCTAssertEqual(try remote.mux.receive(TunnelMux.frame(.fin, 3)), [.fin(3)])
  }

  func testQueuedWritesCoalesceIntoOneRecord() throws {
    let mux = TunnelMux()
    mux.open(1); mux.open(3)
    for chunk in ["GET / HTTP/1.1\r\n", "Host: 127.0.0.1\r\n", "\r\n"] { mux.write(1, Data(chunk.utf8)) }
    mux.write(3, Data("hello".utf8)); mux.write(3, Data(" world".utf8)); mux.end(3)
    let record = try XCTUnwrap(mux.nextRecord())
    XCTAssertEqual(try decodeFrames(record.plain), [
      MuxFrameValue(.open, 1), MuxFrameValue(.open, 3),
      MuxFrameValue(.data, 1, Data("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".utf8)),
      MuxFrameValue(.data, 3, Data("hello world".utf8)), MuxFrameValue(.fin, 3)
    ])
    XCTAssertEqual(record.drained, [1, 3])
    XCTAssertNil(mux.nextRecord())

    for _ in 0..<10 { mux.write(1, Data(repeating: 1, count: 10_000)) }
    let full = try XCTUnwrap(mux.nextRecord())
    XCTAssertEqual(full.plain.count, maxPlain)
    XCTAssertEqual(full.dataBytes, maxPlain - 9)
    XCTAssertEqual(try XCTUnwrap(mux.nextRecord()).dataBytes, 100_000 - (maxPlain - 9))
    XCTAssertNil(mux.nextRecord())
  }
}
