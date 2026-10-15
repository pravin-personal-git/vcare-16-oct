/**
 * Copy the website's shared files into the app, for a CLOUD build.
 *
 * Metro resolves `@shared/...` to `../atlas-app/src` - the app has no business
 * rules of its own and the Hindi dictionary, the shift maths and the scan rules
 * are imported rather than duplicated (see metro.config.js). That works locally,
 * where the sibling folder exists. It cannot work on EAS: the cloud build
 * uploads THIS directory and nothing above it, so `../atlas-app` is not there
 * and the bundle fails at the first `@shared/` import.
 *
 * So before a cloud build, the handful of files actually imported are copied
 * into `shared-build/`, which metro prefers when it exists. The website stays
 * the only place they are edited - this folder is generated, never committed,
 * and `npm run vendor:clean` removes it.
 *
 *   node scripts/vendor-shared.cjs
 */
const fs = require('fs');
const path = require('path');

const app = path.resolve(__dirname, '..');
const src = path.resolve(app, '../atlas-app/src');
const out = path.join(app, 'shared-build');

/**
 * Exactly what is imported, listed rather than globbed.
 *
 * A glob would copy the website's whole `lib` folder into a phone bundle,
 * including files that import the database. The point of `@shared` is that only
 * pure files cross the line, and an explicit list is what keeps that true.
 */
const FILES = [
  'lib/job-flow.ts',
  'lib/shift.ts',
  'lib/translate-text.ts',
  'lib/date-windows.ts',
  'lib/scan/extraction.ts',
  'lib/scan/codes.ts',     // imported by extraction.ts
  'i18n/hi-dictionary.json',
  // Quotation / order / invoice arithmetic (13 Oct 2026, native admin sales): the phone shows the same totals the server will save.
  'lib/quotation-totals.ts',
  // Does an invoice need approval? The website's own rule, run offline on the phone (part 3, decision S2).
  'lib/approval-rules.ts',
];

fs.rmSync(out, { recursive: true, force: true });
for (const rel of FILES) {
  const from = path.join(src, rel);
  if (!fs.existsSync(from)) throw new Error(`Shared file missing: ${from}`);
  const to = path.join(out, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`Vendored ${FILES.length} shared files into ${out}`);
