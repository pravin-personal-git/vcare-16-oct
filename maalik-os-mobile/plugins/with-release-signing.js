/**
 * Sign release builds with the MAALIK OS release key.
 *
 * The key never lives in the repository. The build reads a properties file
 * (storeFile, keyAlias, storePassword, keyPassword) from
 *   MAALIK_KEYSTORE_PROPERTIES, or ~/.maalik-os/keystore.properties
 * When there is none (another machine, CI), release builds fall back to the
 * debug key so the build still works - such an APK is for testing only and
 * cannot update one signed with the real key.
 *
 * KEEP THE KEY AND ITS PASSWORD BACKED UP. Every future update, and the
 * Play Store upload key, must be signed with this same key.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// maalik-os release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;

    const loader = `
${MARK}
def maalikProps = new Properties()
def maalikPropsFile = file(System.getenv('MAALIK_KEYSTORE_PROPERTIES') ?: "\${System.getProperty('user.home')}/.maalik-os/keystore.properties")
if (maalikPropsFile.exists()) { maalikPropsFile.withInputStream { maalikProps.load(it) } }
`;
    g = g.replace(/android\s*\{/, (m) => `${loader}\n${m}`);

    g = g.replace(/signingConfigs\s*\{/, (m) => `${m}
        maalik {
            if (maalikProps['storeFile']) {
                storeFile file(maalikProps['storeFile'])
                storePassword maalikProps['storePassword']
                keyAlias maalikProps['keyAlias']
                keyPassword maalikProps['keyPassword']
            }
        }`);

    // In the release build type, use the real key when it is present.
    g = g.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, (_m, head) =>
      `${head}signingConfig maalikProps['storeFile'] ? signingConfigs.maalik : signingConfigs.debug`);

    cfg.modResults.contents = g;
    return cfg;
  });
};
