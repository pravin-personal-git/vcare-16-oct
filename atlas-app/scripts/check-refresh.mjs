/**
 * Fail the build when a screen re-reads the database too often (31 Oct 2026).
 *
 * The website's AutoRefresh at 5 s used ~50 GB of Supabase egress in two weeks
 * and stopped the project. Every refresh re-runs the whole page's queries, so
 * the floor is 30 s on the website and 15 s in the phone app (whose list
 * screens ask for less). Runs first in `npm run build`, next to check-db-url.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const CHECKS = [
  // <AutoRefresh everyMs={5000} /> and the component's own default.
  { dir: 'src', floor: 30_000, patterns: [/everyMs=\{\s*([\d_]+)\s*\}/g, /everyMs\s*=\s*([\d_]+)/g] },
  // useLoad(load, { everyMs: 15000 }) in the phone app, when it is checked out alongside.
  { dir: '../maalik-os-mobile/src', floor: 15_000, patterns: [/everyMs:\s*([\d_]+)/g] },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield p;
  }
}

const problems = [];
for (const { dir, floor, patterns } of CHECKS) {
  if (!existsSync(dir)) continue;
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const ms = Number(m[1].replaceAll('_', ''));
        if (ms < floor) {
          const line = text.slice(0, m.index).split('\n').length;
          problems.push(`${relative('.', file)}:${line} refreshes every ${ms} ms - the floor is ${floor} ms`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error('Refresh too frequent - each refresh re-reads the database (Supabase egress):\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('  Refresh intervals look right.');
