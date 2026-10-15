/**
 * Copy the app to a build folder whose path has no spaces, for native builds.
 *
 * Android's native build (CMake + ninja) loops forever - "Re-running CMake..."
 * - when the project path contains a space, and this repository lives under
 * "C:\Users\ADHEESH NAIR\...". Mapping a drive letter does not help (Node
 * resolves it back to the real path). So native builds run from a mirror:
 *
 *   <MAALIK_BUILD_DIR, default C:\build>\maalik-os-mobile   <- this app
 *   <MAALIK_BUILD_DIR>\atlas-app\src\lib, \src\i18n          <- shared code (metro.config.js)
 *
 * The repo stays the only place code is edited. node_modules, android/ and
 * build output are never copied - the mirror keeps its own, so a re-sync is
 * a few seconds. Files deleted in the repo are deleted in the mirror.
 *
 *   node scripts/mirror.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoSrc = path.resolve(root, '..');
const out = process.env.MAALIK_BUILD_DIR || 'C:\\build';
if (/\s/.test(out)) throw new Error(`The build folder must not contain spaces: ${out}`);

// android/ and ios/ are generated at the app's root only - a local module's own
// android/ folder (modules/*/android) is source and must be copied.
const SKIP = new Set(['node_modules', '.expo', 'dist', 'web-build', '.git', 'build', '.gradle']);
const SKIP_ROOT = new Set([...SKIP, 'android', 'ios']);

/** Mirror `from` into `to`: copy new/changed files, remove what no longer exists. */
function mirror(from, to, skip = SKIP) {
  fs.mkdirSync(to, { recursive: true });
  const want = new Set();
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    want.add(e.name);
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) mirror(a, b, SKIP);
    else {
      const sa = fs.statSync(a);
      const sb = fs.existsSync(b) ? fs.statSync(b) : null;
      if (!sb || sb.size !== sa.size || sb.mtimeMs < sa.mtimeMs) fs.copyFileSync(a, b);
    }
  }
  for (const e of fs.readdirSync(to, { withFileTypes: true })) {
    if (skip.has(e.name) || want.has(e.name)) continue;
    fs.rmSync(path.join(to, e.name), { recursive: true, force: true });
  }
}

mirror(root, path.join(out, 'maalik-os-mobile'), SKIP_ROOT);
for (const part of ['lib', 'i18n']) {
  mirror(path.join(repoSrc, 'atlas-app', 'src', part), path.join(out, 'atlas-app', 'src', part));
}
console.log(`Mirrored to ${out}\\maalik-os-mobile`);
