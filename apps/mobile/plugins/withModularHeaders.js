const { withPodfile } = require('@expo/config-plugins');

// AppCheckCore (via @react-native-google-signin/google-signin -> Firebase) is a Swift pod
// that needs modular headers to build as a static library. expo-build-properties has no
// option for this, so we inject `use_modular_headers!` directly into the generated Podfile.
function withModularHeaders(config) {
  return withPodfile(config, (config) => {
    if (!config.modResults.contents.includes('use_modular_headers!')) {
      config.modResults.contents = config.modResults.contents.replace(
        'use_expo_modules!',
        'use_expo_modules!\n  use_modular_headers!'
      );
    }
    return config;
  });
}

module.exports = withModularHeaders;
