// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SupatermRelayTunnel",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [.library(name: "RelayTunnelCore", targets: ["RelayTunnelCore"])],
  targets: [
    .target(name: "RelayTunnelCore"),
    .testTarget(name: "RelayTunnelCoreTests", dependencies: ["RelayTunnelCore"],
                resources: [.copy("vectors.json")])
  ]
)
