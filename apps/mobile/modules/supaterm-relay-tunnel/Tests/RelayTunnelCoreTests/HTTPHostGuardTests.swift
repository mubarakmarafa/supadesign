import XCTest
@testable import RelayTunnelCore

final class HTTPHostGuardTests: XCTestCase {
  private let authority = "127.0.0.1:40000"

  func testStripsCookiesOnEveryRequestWithoutChangingHeadersOrBodies() throws {
    let first = "POST /upload HTTP/1.1\r\nHost: \(authority)\r\nAuthorization: Bearer synthetic\r\nX-Name: café\r\nContent-Length: 3\r\n"
    let second = "POST /next HTTP/1.1\r\nHost: \(authority)\r\nTransfer-Encoding: chunked\r\n"
    let input = (first + "cOoKiE: first=secret\r\nCookie: second=secret\r\nCOOKIE2: old=secret\r\n\r\nabc" +
      second + "Cookie: third=secret\r\n\r\n3\r\nxyz\r\n0\r\n\r\n").data(using: .isoLatin1)!
    let expected = (first + "\r\nabc" + second + "\r\n3\r\nxyz\r\n0\r\n\r\n").data(using: .isoLatin1)!
    for size in [1, input.count] {
      var guardHTTP = HTTPHostGuard(authority: authority)
      var output = Data()
      for offset in stride(from: 0, to: input.count, by: size) {
        output.append(try guardHTTP.feed(input.subdata(in: offset..<min(offset + size, input.count))))
      }
      XCTAssertEqual(output, expected)
      try guardHTTP.finish()
    }
  }

  func testStripsUpgradeCookiesBeforeForwardingOpaquePayload() throws {
    var guardHTTP = HTTPHostGuard(authority: authority)
    let head = "GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n"
    let payload = Data([0x82, 3, 1, 2, 3])
    let request = Data((head + "Cookie: session=secret\r\nCookie2: old=secret\r\n\r\n").utf8)
    XCTAssertEqual(try guardHTTP.feed(request + payload), Data((head + "\r\n").utf8))
    XCTAssertEqual(try guardHTTP.observeResponse(Data("HTTP/1.1 101 Switching Protocols\r\n\r\n".utf8)), payload)
    try guardHTTP.finish()
  }

  func testUpgradeRequiresAFreshBodilessConnection() throws {
    for body in ["Content-Length: 1\r\n", "Transfer-Encoding: chunked\r\n"] {
      var guardHTTP = HTTPHostGuard(authority: authority)
      let head = "GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\(body)\r\n"
      XCTAssertThrowsError(try guardHTTP.feed(Data(head.utf8)))
    }
    var guardHTTP = HTTPHostGuard(authority: authority)
    _ = try guardHTTP.feed(Data("GET /first HTTP/1.1\r\nHost: \(authority)\r\n\r\n".utf8))
    XCTAssertThrowsError(try guardHTTP.feed(Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8)))
  }

  func testUpgradeHeaderDoesNotAuthorizeUnconfirmedBytes() throws {
    var guardHTTP = HTTPHostGuard(authority: authority)
    let head = Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8)
    XCTAssertEqual(try guardHTTP.feed(head), head)
    XCTAssertEqual(try guardHTTP.feed(Data("GET /foreign HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n".utf8)), Data())
  }

  func testFragmentedInterimResponsesReleasePayloadOnlyAfter101() throws {
    var guardHTTP = HTTPHostGuard(authority: authority)
    let head = Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8)
    let payload = Data([0x82, 3, 1, 2, 3])
    XCTAssertEqual(try guardHTTP.feed(head + payload), head)
    XCTAssertThrowsError(try guardHTTP.finish())
    XCTAssertTrue(guardHTTP.awaitingUpgrade)
    let interim = Data("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: </style.css>\r\n\r\n".utf8)
    for byte in interim { XCTAssertEqual(try guardHTTP.observeResponse(Data([byte])), Data()) }
    var released = Data()
    for byte in Data("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n".utf8) {
      released.append(try guardHTTP.observeResponse(Data([byte])))
    }
    XCTAssertEqual(released, payload)
    XCTAssertFalse(guardHTTP.awaitingUpgrade)
    XCTAssertEqual(try guardHTTP.feed(payload), payload)
    try guardHTTP.finish()
  }

  func testRejectedUpgradeRevalidatesAnEarlyForeignRequest() throws {
    var guardHTTP = HTTPHostGuard(authority: authority)
    let head = Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8)
    let foreign = Data("GET /foreign HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n".utf8)
    XCTAssertEqual(try guardHTTP.feed(head + foreign), head)
    XCTAssertThrowsError(try guardHTTP.observeResponse(Data("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n".utf8)))
  }

  func testAResponseBodyCannotResurrectARejectedUpgrade() throws {
    var guardHTTP = HTTPHostGuard(authority: authority)
    _ = try guardHTTP.feed(Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8))
    let fake101 = Data("HTTP/1.1 101 Switching Protocols\r\n\r\n".utf8)
    _ = try guardHTTP.observeResponse(Data("HTTP/1.1 200 OK\r\nContent-Length: \(fake101.count)\r\n\r\n".utf8) + fake101)
    XCTAssertEqual(try guardHTTP.observeResponse(fake101), Data())
    XCTAssertThrowsError(try guardHTTP.feed(Data("GET /foreign HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n".utf8)))
  }

  func testBoundsUpgradePayloadAndCompleteResponseHeaders() throws {
    for kind in ["payload", "response"] {
      var guardHTTP = HTTPHostGuard(authority: authority)
      _ = try guardHTTP.feed(Data("GET /ws HTTP/1.1\r\nHost: \(authority)\r\nUpgrade: websocket\r\n\r\n".utf8))
      let huge = Data(repeating: 65, count: 65537)
      if kind == "payload" { XCTAssertThrowsError(try guardHTTP.feed(huge)) }
      else { XCTAssertThrowsError(try guardHTTP.observeResponse(huge + Data("\r\n\r\n".utf8))) }
    }
  }

  func testFinishRejectsTruncatedBodies() throws {
    for body in ["Content-Length: 4\r\n\r\nab", "Transfer-Encoding: chunked\r\n\r\n4\r\nab"] {
      var guardHTTP = HTTPHostGuard(authority: authority)
      _ = try guardHTTP.feed(Data("POST /upload HTTP/1.1\r\nHost: \(authority)\r\n\(body)".utf8))
      XCTAssertThrowsError(try guardHTTP.finish())
    }
  }
}
