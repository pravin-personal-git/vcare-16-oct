#!/usr/bin/env node
/**
 * Refuses to run `prisma migrate dev` against the production database.
 *
 * `migrate dev` is a development tool and behaves like one: when it finds a
 * state it cannot reconcile, it offers to drop the database and start again,
 * because it assumes the data is disposable. Pointed at production that offer
 * is a catastrophe, and it arrives as a normal-looking prompt at the end of a
 * long day. It happened on this project on 16 August.
 *
 * Production is identified by comparing against `.env.production` rather than
 * by hostname. Every Supabase project in a region shares one pooler host, so
 * the host says nothing — the project is in the username. Guessing from the
 * hostname is what led to this file being written against the wrong premise in
 * the first place.
 *
 * Production migrations go through `npm run db:deploy`, which only applies what
 * is pending and has no reset path.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function urlFrom(file) {
  // Read the env files directly. Prisma loads them itself, so adding dotenv
  // here just to find out which database we are about to alter would be a
  // dependency taken on for a warning.
  if (!existsSync(file)) return null;
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

/**
 * Which database a connection string points at.
 *
 * Username and host together, because on Supabase the project reference lives
 * in the username — `postgres.<ref>` — and every project in a region shares one
 * pooler hostname. Port and pooling flags are ignored: the pooled and direct
 * URLs for one project differ there and are still the same database.
 */
function identity(url) {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

const url = process.env.DATABASE_URL ?? urlFrom('.env');
if (!url) {
  console.error('No DATABASE_URL found. Set one in .env before migrating.');
  process.exit(1);
}

const here = identity(url);
if (!here) {
  console.error('DATABASE_URL is not a URL this script can read. Refusing to guess.');
  process.exit(1);
}

const prodUrl = urlFrom('.env.production');
const prod = prodUrl ? identity(prodUrl) : null;

if (prod && here === prod) {
  const shown = new URL(url).username;
  console.log('');
  console.log('  ⛔  This is the PRODUCTION database.');
  console.log('');
  console.log(`        ${shown}`);
  console.log('');
  console.log('  It matches DATABASE_URL in .env.production.');
  console.log('');
  console.log('  `migrate dev` will offer to DROP THE ENTIRE DATABASE if it finds a');
  console.log('  state it cannot reconcile, because it assumes the data is');
  console.log('  disposable. On production it is not.');
  console.log('');
  console.log('  To apply pending migrations safely:  npm run db:deploy:prod');
  console.log('');
  // No prompt. A confirmation here would only teach the habit of confirming.
  // There is no case where `migrate dev` against production is the right
  // command, so this refuses rather than asks.
  process.exit(1);
}

if (!prodUrl) {
  // This used to be a one-line "Note:". It is the case where the guard is
  // BLIND — with no .env.production to compare against, this script cannot
  // tell production from development, and `migrate dev` still offers to drop
  // the database. A quiet note in a wall of Prisma output is not a warning
  // anybody reads; it scrolled past unnoticed for a full day on 6 Sep 2026.
  console.log('');
  console.log('  ⚠️  THIS GUARD IS NOT PROTECTING YOU.');
  console.log('');
  console.log('  There is no .env.production to compare against, so this cannot tell');
  console.log(`  whether ${new URL(url).username} is production or development.`);
  console.log('');
  console.log('  `migrate dev` offers to DROP THE ENTIRE DATABASE when it finds a state');
  console.log('  it cannot reconcile. Check the username above against Supabase before');
  console.log('  you answer any prompt.');
  console.log('');
  console.log('  To restore the guard:  Copy-Item .env.production.example .env.production');
  console.log('');
}

/**
 * Run Prisma's CLI **as a Node script**, never through a shell wrapper.
 *
 * This line has now failed twice on Windows, in two different ways, and both
 * failures shared one cause: `npx` on Windows is not a program, it is
 * `npx.cmd` — a batch file.
 *
 *   1. `spawn('npx', …)` → **ENOENT**. `spawn` does no PATH extension
 *      resolution, so it looked for a file literally called `npx`. The message
 *      reads as if npx were not installed.
 *   2. `spawn('npx.cmd', …)` → **EINVAL** on Node 24. Node now refuses to spawn
 *      `.cmd` and `.bat` files without `shell: true`, because the Windows batch
 *      parser re-interprets arguments — that was CVE-2024-27980, an argument
 *      injection. Naming the `.cmd` explicitly stopped being a fix.
 *
 * And `shell: true` is not the answer either: Node deprecated it with arguments
 * (DEP0190) for the same injection reason, and these arguments come from
 * `process.argv` — a shell here would be an injection point in a script whose
 * entire job is to be a safety rail.
 *
 * So skip the wrapper. Prisma's CLI is an ordinary JavaScript file; resolve it
 * out of `node_modules` and run it with the Node binary already executing this
 * script. No PATH lookup, no batch parser, no shell, and identical behaviour on
 * every platform.
 *
 * WHY THIS MATTERS MORE THAN A FAILED COMMAND
 *
 * Both failures were loud, but their *consequence* was silent. `npm run
 * db:migrate` exited without migrating; a developer then reasonably ran
 * `npx prisma generate` by hand to clear the type errors — and it worked. The
 * Prisma **client** gained the new models while the **database** did not, and
 * the first page to touch one crashed with a missing-table error that looks
 * like an application bug rather than a migration that never ran.
 *
 * ENOENT found 6 Sep 2026 on Node 22; EINVAL the same day on Node 24.
 */
const require = createRequire(import.meta.url);

let prismaCli;
try {
  // Read `bin` from prisma's own package.json rather than hard-coding
  // `build/index.js` — that path is Prisma's implementation detail and has
  // moved between major versions.
  const pkgPath = require.resolve('prisma/package.json');
  const bin = JSON.parse(readFileSync(pkgPath, 'utf8')).bin;
  const rel = typeof bin === 'string' ? bin : bin?.prisma;
  if (!rel) throw new Error('prisma/package.json declares no bin entry');
  prismaCli = join(dirname(pkgPath), rel);
} catch (err) {
  console.error('');
  console.error('  Could not find the Prisma CLI in node_modules.');
  console.error(`  ${err.message}`);
  console.error('');
  console.error('  Run `npm install` and try again.');
  console.error('');
  process.exit(1);
}

const child = spawn(
  process.execPath,                       // the Node binary running this file
  [prismaCli, 'migrate', 'dev', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

child.on('error', (err) => {
  console.error('\n  Could not start prisma.\n', err.message, '\n');
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
