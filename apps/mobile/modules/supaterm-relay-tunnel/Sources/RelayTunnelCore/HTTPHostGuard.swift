import Foundation

struct HTTPHostGuard {
  enum Phase { case headers, body(Int), chunkSize, chunk(Int), chunkCRLF, trailers, awaitingUpgrade, opaque }
  let authority: String
  var phase: Phase = .headers
  var buffered = Data()
  private var response = Data()
  private var requests = 0
  private let delimiter = Data("\r\n\r\n".utf8)
  init(authority: String) {
    self.authority = authority
  }
  var awaitingUpgrade: Bool {
    if case .awaitingUpgrade = phase { return true }
    return false
  }
  mutating func observeResponse(_ bytes: Data) throws -> Data {
    guard awaitingUpgrade else { return Data() }
    response.append(bytes)
    while true {
      guard let end = response.range(of: delimiter) else {
        guard response.count <= 65536 else { throw RelayError.invalid("HTTP response headers too large") }
        return Data()
      }
      let count = end.upperBound - response.startIndex
      guard count <= 65536, let text = String(data: response.prefix(count), encoding: .isoLatin1),
            let first = text.components(separatedBy: "\r\n").first else {
        throw RelayError.invalid("Invalid HTTP response")
      }
      let fields = first.split(separator: " ", omittingEmptySubsequences: false)
      guard fields.count >= 2, ["HTTP/1.0", "HTTP/1.1"].contains(String(fields[0])),
            fields[1].count == 3, let status = Int(fields[1]), (100..<600).contains(status) else {
        throw RelayError.invalid("Invalid HTTP response")
      }
      response.removeFirst(count)
      if (100..<200).contains(status) && status != 101 { continue }
      phase = status == 101 ? .opaque : .headers
      response.removeAll()
      return try feed(Data())
    }
  }
  func finish() throws {
    switch phase {
    case .headers, .opaque:
      guard buffered.isEmpty else { throw RelayError.invalid("Truncated HTTP request") }
    default: throw RelayError.invalid("Truncated HTTP request")
    }
  }
  mutating func feed(_ bytes: Data) throws -> Data {
    buffered.append(bytes)
    var output = Data()
    while !buffered.isEmpty {
      switch phase {
      case .awaitingUpgrade:
        guard buffered.count <= 65536 else { throw RelayError.invalid("Too much data before HTTP upgrade") }
        return output
      case .opaque:
        output.append(buffered); buffered.removeAll(keepingCapacity: true)
      case .headers:
        guard let end = buffered.range(of: delimiter) else {
          if buffered.count > 16384 { throw RelayError.invalid("HTTP headers too large") }
          return output
        }
        let count = end.upperBound - buffered.startIndex
        guard count <= 16384, let text = String(data: buffered.prefix(count), encoding: .isoLatin1) else {
          throw RelayError.invalid("Invalid HTTP headers")
        }
        let lines = text.components(separatedBy: "\r\n")
        guard let first = lines.first else { throw RelayError.invalid("Invalid HTTP request target") }
        let request = first.split(separator: " ", omittingEmptySubsequences: false)
        guard request.count == 3, request[2] == "HTTP/1.1", request[1].hasPrefix("/"),
              !request[1].hasPrefix("//") else { throw RelayError.invalid("Invalid HTTP request target") }
        var headers: [String: [String]] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
          guard !line.hasPrefix(" "), !line.hasPrefix("\t"), let colon = line.firstIndex(of: ":") else {
            throw RelayError.invalid("Invalid HTTP header")
          }
          let name = line[..<colon].lowercased()
          guard name.range(of: "^[!#$%&'*+.^_`|~0-9a-z-]+$", options: .regularExpression) != nil else {
            throw RelayError.invalid("Invalid HTTP header")
          }
          headers[name, default: []].append(line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces))
        }
        guard headers["host"] == [authority] else { throw RelayError.invalid("Misdirected HTTP Host") }
        let lengths = headers["content-length"] ?? []
        let transfer = headers["transfer-encoding"] ?? []
        guard lengths.count <= 1, transfer.count <= 1, lengths.isEmpty || transfer.isEmpty else {
          throw RelayError.invalid("Ambiguous HTTP body")
        }
        var size = 0
        if let length = lengths.first {
          guard !length.isEmpty, length.allSatisfy({ $0.isASCII && $0.isNumber }),
                let parsed = Int(length), parsed >= 0 else { throw RelayError.invalid("Invalid HTTP length") }
          size = parsed
        }
        if !transfer.isEmpty {
          guard transfer[0].lowercased() == "chunked" else { throw RelayError.invalid("Unsupported HTTP body") }
        }
        if headers["upgrade"] != nil {
          guard requests == 0, size == 0, transfer.isEmpty else { throw RelayError.invalid("Upgrade requires a fresh connection") }
          phase = .awaitingUpgrade
        } else if !transfer.isEmpty {
          phase = .chunkSize
        } else {
          phase = size == 0 ? .headers : .body(size)
        }
        requests += 1
        if headers["cookie"] != nil || headers["cookie2"] != nil {
          let kept = lines.filter { line in
            let name = line.prefix { $0 != ":" }.lowercased()
            return name != "cookie" && name != "cookie2"
          }
          output.append(kept.joined(separator: "\r\n").data(using: .isoLatin1)!)
        } else {
          output.append(buffered.prefix(count))
        }
        buffered.removeFirst(count)
      case .body(let remaining), .chunk(let remaining):
        let count = min(remaining, buffered.count)
        output.append(buffered.prefix(count)); buffered.removeFirst(count)
        if case .body = phase { phase = count == remaining ? .headers : .body(remaining - count) }
        else { phase = count == remaining ? .chunkCRLF : .chunk(remaining - count) }
      case .chunkSize:
        guard let end = buffered.range(of: Data("\r\n".utf8)) else {
          if buffered.count > 1024 { throw RelayError.invalid("Invalid HTTP chunk") }; return output
        }
        let count = end.upperBound - buffered.startIndex
        guard count <= 1024 else { throw RelayError.invalid("Invalid HTTP chunk") }
        let line = String(decoding: buffered.prefix(count - 2), as: UTF8.self).components(separatedBy: ";")[0]
        guard !line.isEmpty, line.allSatisfy({ $0.isASCII && $0.isHexDigit }),
              let size = Int(line, radix: 16), size >= 0 else { throw RelayError.invalid("Invalid HTTP chunk") }
        output.append(buffered.prefix(count)); buffered.removeFirst(count)
        phase = size == 0 ? .trailers : .chunk(size)
      case .chunkCRLF:
        guard buffered.count >= 2 else { return output }
        guard buffered.prefix(2) == Data("\r\n".utf8) else { throw RelayError.invalid("Invalid HTTP chunk ending") }
        output.append(buffered.prefix(2)); buffered.removeFirst(2); phase = .chunkSize
      case .trailers:
        if buffered.starts(with: Data("\r\n".utf8)) {
          output.append(buffered.prefix(2)); buffered.removeFirst(2); phase = .headers
        } else if let end = buffered.range(of: delimiter) {
          let count = end.upperBound - buffered.startIndex
          guard count <= 16384 else { throw RelayError.invalid("HTTP trailers too large") }
          output.append(buffered.prefix(count)); buffered.removeFirst(count); phase = .headers
        } else {
          if buffered.count > 16384 { throw RelayError.invalid("HTTP trailers too large") }; return output
        }
      }
    }
    return output
  }
}
