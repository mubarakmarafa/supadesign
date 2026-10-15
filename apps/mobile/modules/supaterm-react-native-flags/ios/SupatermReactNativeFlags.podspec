Pod::Spec.new do |s|
  s.name           = 'SupatermReactNativeFlags'
  s.version        = '1.0.0'
  s.summary        = 'React Native feature flag overrides for Supaterm mobile.'
  s.description    = 'Enables React Native feature flags that the prebuilt core leaves off.'
  s.author         = 'Supaterm'
  s.homepage       = 'https://supaterm.com'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.{h,mm,swift}'

  install_modules_dependencies(s)
end
