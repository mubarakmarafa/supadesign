import Foundation

enum RelayFailure: String {
  case hostOffline = "host-offline"
  case relayBusy = "relay-busy"
  case timeout = "relay-timeout"
  case unreachable = "relay-unreachable"

  init(relayStatus: Int?) {
    switch relayStatus {
    case 101, 404: self = .hostOffline
    case 429, 503: self = .relayBusy
    default: self = .unreachable
    }
  }

  var response: Data {
    let status = switch self {
    case .hostOffline, .relayBusy: "503 Service Unavailable"
    case .timeout: "504 Gateway Timeout"
    case .unreachable: "502 Bad Gateway"
    }
    return Data(("HTTP/1.1 \(status)\r\nX-Supaterm-Relay-Error: \(rawValue)\r\nCache-Control: no-store\r\n" +
                 "Connection: close\r\nContent-Length: 0\r\n\r\n").utf8)
  }
}
