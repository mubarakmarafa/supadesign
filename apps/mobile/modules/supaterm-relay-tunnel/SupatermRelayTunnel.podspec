require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'SupatermRelayTunnel'
  s.version = package['version']
  s.summary = 'Native encrypted relay doorway for Supaterm mobile.'
  s.homepage = 'https://supaterm.com'
  s.license = { :type => 'MIT' }
  s.author = { 'Supaterm' => 'hello@supaterm.com' }
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.source_files = 'ios/**/*.swift', 'Sources/RelayTunnelCore/**/*.swift'
  s.frameworks = 'Network', 'CryptoKit'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
end
