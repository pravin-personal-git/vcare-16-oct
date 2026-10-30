// Self-check for the help chat's search: real questions, as staff type them, and the guide each must land on.
//   npx tsx --conditions=react-server scripts/help-search-check.ts
import assert from 'node:assert/strict';
import { search, CONFIDENT } from '../src/lib/help/search';
import { HELP } from '../src/server/help-content';

const CASES: [string, string][] = [
  ['challan kaise raise kare', 'challan-raise'],
  ['chalan kese banaye', 'challan-raise'],
  ['how to raise a challan', 'challan-raise'],
  ['GDN kaise banta hai store se', 'challan-issue'],
  ['bacha hua saman wapas kaise le', 'challan-return'],
  ['No serial numbers available', 'error-no-serial'],
  ['Which serial numbers came back? No serial numbers available', 'error-no-serial'],
  ['serial baad me kaise jode', 'serial-add-later'],
  ['nayi complaint kaise darj kare', 'complaint-new'],
  ['complaint technician ko kaise de', 'complaint-assign'],
  ['quotation kaise banaye', 'enquiry-quotation'],
  ['quotation ko order kaise banaye', 'quotation-order'],
  ['naya lead add karna hai', 'enquiry-new'],
  ['payment kaise jama kare', 'payment-record'],
  ['customer ka paisa aaya upi se', 'payment-record'],
  ['kitna baaki hai customer ka', 'payment-due'],
  ['installation ka bill kaise banaye', 'installation-finish'],
  ['grn kaise kare', 'goods-receipt'],
  ['serial kahan hai pata kaise kare', 'serial-find'],
  ['Select a single store before converting.', 'error-single-store'],
  ['password bhool gaya', 'error-login'],
  ['purane software ka data kahan hai', 'old-data'],
  ['app hindi me kaise kare', 'hindi'],
  ['page loading pe atka hai', 'error-stuck'],
  ['naya customer add karna hai', 'customer-new'],
  ['amc kaise banaye', 'amc-new'],
  ['technician phone pe kaam kaise dekhe', 'tech-phone'],
];

let ok = 0;
for (const [q, want] of CASES) {
  const hits = search(q, HELP);
  const got = hits[0]?.article.id;
  const sure = (hits[0]?.score ?? 0) >= CONFIDENT;
  const pass = got === want;
  if (pass) ok++;
  console.log(`${pass ? (sure ? 'ok  ' : 'ok? ') : 'FAIL'} ${q.padEnd(58)} -> ${got ?? '-'} (${(hits[0]?.score ?? 0).toFixed(2)})${pass ? '' : `  want ${want}; then ${hits.slice(1).map((h) => h.article.id).join(', ')}`}`);
}
console.log(`\n${ok}/${CASES.length} land on the right guide`);
assert.equal(new Set(HELP.map((a) => a.id)).size, HELP.length, 'guide ids must be unique');
for (const a of HELP) for (const r of a.related ?? []) assert.ok(HELP.some((b) => b.id === r), `${a.id} relates to missing ${r}`);
assert.equal(ok, CASES.length, 'every question must land on its guide');
