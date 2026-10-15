// Metro, with the website's shared code visible to the app.
//
// The app has no business rules of its own (see the roadmap): the pure files
// in atlas-app/src/lib - the Hindi translator, the scan rules - and the Hindi
// dictionary are imported from the website, not copied. Only those two
// folders are watched, never atlas-app as a whole, and only files with no
// server imports may be used through `@shared/...`.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Where the shared files are.
 *
 * Locally: the website's own `src`, so there is one copy and editing it is
 * editing the real thing. On EAS: `shared-build/`, written by
 * `scripts/vendor-shared.cjs` before the build - a cloud build uploads this
 * directory and nothing above it, so `../atlas-app` does not exist there and
 * every `@shared/` import would fail to resolve.
 *
 * The vendored folder is generated and never committed, so it cannot drift:
 * if it is present it was made from the website minutes ago.
 */
const vendored = path.resolve(__dirname, 'shared-build');
const shared = fs.existsSync(vendored) ? vendored : path.resolve(__dirname, '../atlas-app/src');

config.watchFolders = [path.join(shared, 'lib'), path.join(shared, 'i18n')]
  .filter((p) => fs.existsSync(p));

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@shared/')) {
    return context.resolveRequest(context, path.join(shared, moduleName.slice('@shared/'.length)), platform);
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
