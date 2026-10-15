import Foundation

let streamWindow = 2 * 1024 * 1024
let sessionWindow = 8 * 1024 * 1024
let minimumCost = 48 * 1024
let maxPlain = 64 * 1024

enum MuxFrame: UInt8 { case open = 1, data, window, fin, reset, ping, pong }

enum MuxEvent: Equatable { case data(UInt32, Data), fin(UInt32), reset(UInt32), credit(UInt32) }

struct MuxRecord {
  let plain: Data
  let dataBytes: Int
  let drained: [UInt32]
}

final class MuxStream {
  let id: UInt32
  var pending = Data()
  var sendCredit = streamWindow
  var receiveCredit = streamWindow
  var receiveGrant = 0
  var unconsumed = 0
  var localEnded = false
  var finSent = false
  var remoteEnded = false
  init(id: UInt32) { self.id = id }
}

final class TunnelMux {
  var onPong: () -> Void = {}
  private(set) var streams: [UInt32: MuxStream] = [:]
  private var controls: [Data] = []
  private var sendCredit = sessionWindow
  private var receiveCredit = sessionWindow
  private var receiveGrant = 0
  private var roundRobin: UInt32 = 0
  private var receivedSinceTick = false
  private var idleTicks = 0

  static func frame(_ type: MuxFrame, _ id: UInt32, _ payload: Data = Data()) -> Data {
    Data([type.rawValue]) + Data(bigEndian: id) + Data(bigEndian: UInt32(payload.count)) + payload
  }

  func open(_ id: UInt32) {
    streams[id] = MuxStream(id: id)
    controls.append(Self.frame(.open, id))
  }

  func write(_ id: UInt32, _ data: Data) { streams[id]?.pending.append(data) }

  func end(_ id: UInt32) { streams[id]?.localEnded = true }

  func close(_ id: UInt32, reset: Bool) {
    guard let stream = streams.removeValue(forKey: id) else { return }
    if reset { controls.append(Self.frame(.reset, id)) }
    grant(stream.unconsumed)
  }

  func consumed(_ id: UInt32, bytes: Int) {
    guard bytes > 0, let stream = streams[id] else { return }
    stream.unconsumed -= bytes
    grant(bytes)
    stream.receiveGrant += bytes
    guard stream.receiveGrant >= streamWindow / 4 else { return }
    controls.append(window(id, stream.receiveGrant))
    stream.receiveCredit += stream.receiveGrant; stream.receiveGrant = 0
  }

  func tick() throws {
    defer { receivedSinceTick = false }
    guard !receivedSinceTick else { idleTicks = 0; return }
    idleTicks += 1
    guard idleTicks < 3 else { throw RelayError.invalid("Relay session timed out") }
    controls.append(Self.frame(.ping, 0))
  }

  func ping() { controls.append(Self.frame(.ping, 0)) }

  func receive(_ plain: Data) throws -> [MuxEvent] {
    receivedSinceTick = true
    var frames: [(MuxFrame, UInt32, Data)] = []
    var offset = 0; var dataBytes = 0
    while offset < plain.count {
      guard offset + 9 <= plain.count else { throw RelayError.invalid("Truncated mux frame") }
      let length = Int(plain.uint32(at: offset + 5)); let start = offset + 9
      guard start + length <= plain.count else { throw RelayError.invalid("Truncated mux payload") }
      guard let type = MuxFrame(rawValue: plain[plain.startIndex + offset]) else {
        throw RelayError.invalid("Unknown mux frame")
      }
      let payload = plain.subdata(in: (plain.startIndex + start)..<(plain.startIndex + start + length))
      frames.append((type, plain.uint32(at: offset + 1), payload))
      if type == .data { dataBytes += length }
      offset = start + length
    }
    if dataBytes > 0 {
      let cost = max(dataBytes, minimumCost)
      guard cost <= receiveCredit else { throw RelayError.invalid("Session receive window exceeded") }
      receiveCredit -= cost
      grant(cost - dataBytes)
    }
    var events: [MuxEvent] = []
    for (type, id, payload) in frames {
      switch type {
      case .window:
        guard payload.count == 4 else { throw RelayError.invalid("Invalid mux window") }
        let bytes = Int(payload.uint32(at: 0))
        if id == 0 {
          guard bytes > 0, sendCredit + bytes <= sessionWindow else { throw RelayError.invalid("Session window overflow") }
          sendCredit += bytes
        } else if let stream = streams[id] {
          guard bytes > 0, stream.sendCredit + bytes <= streamWindow else { throw RelayError.invalid("Stream window overflow") }
          stream.sendCredit += bytes
          events.append(.credit(id))
        }
      case .data:
        guard id != 0 else { throw RelayError.invalid("Invalid mux stream") }
        guard let stream = streams[id] else { grant(payload.count); continue }
        guard !stream.remoteEnded, payload.count <= stream.receiveCredit else {
          throw RelayError.invalid("Stream receive window exceeded")
        }
        stream.receiveCredit -= payload.count; stream.unconsumed += payload.count
        events.append(.data(id, payload))
      case .fin:
        guard payload.isEmpty, id != 0 else { throw RelayError.invalid("Invalid mux FIN") }
        if let stream = streams[id], !stream.remoteEnded {
          stream.remoteEnded = true
          events.append(.fin(id))
        }
      case .reset:
        guard payload.isEmpty, id != 0 else { throw RelayError.invalid("Invalid mux RST") }
        if streams[id] != nil {
          close(id, reset: false)
          events.append(.reset(id))
        }
      case .ping:
        guard payload.isEmpty, id == 0 else { throw RelayError.invalid("Invalid mux PING") }
        controls.append(Self.frame(.pong, 0))
      case .pong:
        guard payload.isEmpty, id == 0 else { throw RelayError.invalid("Invalid mux PONG") }
        onPong()
      case .open:
        throw RelayError.invalid("Unknown mux frame")
      }
    }
    return events
  }

  func nextRecord() -> MuxRecord? {
    var plain = Data(); var dataBytes = 0
    var drained: [UInt32] = []
    var taken = 0
    for control in controls {
      guard plain.count + control.count <= maxPlain else { break }
      plain.append(control); taken += 1
    }
    controls.removeFirst(taken)
    let ready = streams.values.sorted { $0.id < $1.id }
    for stream in ready.filter({ $0.id > roundRobin }) + ready.filter({ $0.id <= roundRobin }) {
      let room = min(maxPlain - plain.count - 9, stream.sendCredit,
                     sendCredit >= minimumCost ? sendCredit - dataBytes : 0)
      if !stream.pending.isEmpty && room > 0 {
        let count = min(room, stream.pending.count)
        plain.append(Self.frame(.data, stream.id, stream.pending.prefix(count)))
        stream.pending.removeFirst(count); stream.sendCredit -= count; dataBytes += count
        roundRobin = stream.id
        if stream.pending.isEmpty { drained.append(stream.id) }
      }
      if stream.pending.isEmpty && stream.localEnded && !stream.finSent && plain.count + 9 <= maxPlain {
        stream.finSent = true
        plain.append(Self.frame(.fin, stream.id))
      }
    }
    guard !plain.isEmpty else { return nil }
    if dataBytes > 0 { sendCredit -= max(dataBytes, minimumCost) }
    return MuxRecord(plain: plain, dataBytes: dataBytes, drained: drained)
  }

  private func window(_ id: UInt32, _ bytes: Int) -> Data { Self.frame(.window, id, Data(bigEndian: UInt32(bytes))) }

  private func grant(_ bytes: Int) {
    receiveGrant += bytes
    guard receiveGrant > 0, receiveGrant >= sessionWindow / 4 || receiveCredit < sessionWindow / 4 else { return }
    controls.append(window(0, receiveGrant))
    receiveCredit += receiveGrant; receiveGrant = 0
  }
}
