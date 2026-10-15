/**
 * Push notifications in CLOUD builds (5 Oct 2026).
 *
 * Firebase's google-services.json is kept out of git and out of the EAS upload
 * (.easignore), so every cloud build until 1.0.13 was made without it - and a
 * build without it cannot register for push at all. The file now lives on EAS
 * as a secret file variable, GOOGLE_SERVICES_JSON (preview + production); EAS
 * writes it to disk on the builder and passes its path in that variable.
 *
 * Everything else still comes from app.json. On this laptop, with no
 * variable set, the local file is used as before.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
});
