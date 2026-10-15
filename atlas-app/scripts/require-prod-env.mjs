#!/usr/bin/env node
/**
 * Refuses to run a `:prod` script unless `.env.production` really exists and
 * really points somewhere else.
 *
 * WHY THIS EXISTS
 *
 * Every production script is `dotenv -e .env.production -- <command>`. When
 * that file is **missing**, dotenv-cli does not fail — it carries on, and the
 * command loads `.env` instead. So the script runs happily against the
 * DEVELOPMENT database while printing output that looks exactly like success.
 *
 * That is what happened on 6 September 2026. `npm run db:defaults:prod`
 * reported "Permissions: 36 total (0 new)" — byte-identical to the local run,
 * because it was the local database. Production never received the three
 * `returns.*` permission grants, and the Sales Return screen sat there with
 * every button greyed out on the live site while working perfectly on
 * localhost. Nothing anywhere said the command had targeted the wrong database.
 *
 * The mirror image of that mistake is the one that ends a company: believing a
 * command is hitting dev when it is hitting production. `db:demo:prod` seeds
 * demo data. `db:clear-txn:prod` deletes transactions. Both are one missing
 * file away from being pointed at the wrong place with no warning at all.
 *
 * A silent fallback is the worst possible behaviour for a script whose whole
 * meaning is *which database am I talking to*. So this refuses, loudly, and
 * says exactly what to do.
 */

import { readFileSync, existsSync } from 'node:fs';

const PROD = '.env.production';
const DEV = '.env';

function urlFrom(file) {
  if (!existsSync(file)) return null;
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

/**
 * Username and host together — on Supabase the project reference lives in the
 * username (`postgres.<ref>`) and every project in a region shares one pooler
 * hostname, so the host alone identifies nothing.
 */
function identity(url) {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

if (!existsSync(PROD)) {
  die([
    '⛔  .env.production is missing.',
    '',
    'Every `:prod` script is `dotenv -e .env.production -- …`. With that file',
    'absent, dotenv does NOT fail — it falls through to .env, and the command',
    'runs against DEVELOPMENT while looking like it succeeded.',
    '',
    'Create it from the template and fill in the production credentials:',
    '',
    '    Copy-Item .env.production.example .env.production',
    '',
    'Get the values from Supabase → atlas-prod → Settings → Database.',
    'It is gitignored. Never commit it, never paste it into a chat.',
  ]);
}

const prodUrl = urlFrom(PROD);
if (!prodUrl) {
  die([
    '⛔  .env.production exists but has no DATABASE_URL.',
    '',
    'A `:prod` script would load it, find nothing, and silently use .env —',
    'which is the development database.',
  ]);
}

/**
 * The template's placeholders, still in place.
 *
 * `Copy-Item .env.production.example .env.production` produces a file that
 * exists, parses, and has a DATABASE_URL — so every check above passes. What it
 * does not have is credentials. Prisma then fails several seconds later with
 * `FATAL: (ENOTFOUND) tenant/user postgres.<PROD-REF> not found`, which reads
 * like a Supabase outage rather than an unedited file.
 *
 * Checked against the raw string before URL parsing, because `<` and `>` are
 * percent-encoded by `new URL()` — the username comes back as
 * `postgres.%3CPROD-REF%3E`, which no longer contains the word it was looking
 * for. Caught this way on 6 Sep 2026, having printed exactly that.
 */
if (/<[A-Z-]+>|%3C[A-Z-]+%3E/i.test(prodUrl)) {
  die([
    '⛔  .env.production still contains the template placeholders.',
    '',
    'The file was copied but never filled in, so it has no real credentials.',
    '',
    'Open it and replace <PROD-REF> and <PROD-PASSWORD> in BOTH lines:',
    '',
    '    DATABASE_URL   — port 6543, keep ?pgbouncer=true&connection_limit=1',
    '    DIRECT_URL     — port 5432, no query string',
    '',
    'Supabase → atlas-prod → Settings → Database.',
    '<PROD-REF> is the project reference; it is the same in both lines.',
  ]);
}

const prod = identity(prodUrl);
if (!prod) {
  die([
    '⛔  DATABASE_URL in .env.production is not a URL this script can read.',
    '',
    'Refusing to guess which database that is.',
  ]);
}

const devUrl = urlFrom(DEV);
const dev = devUrl ? identity(devUrl) : null;

if (dev && dev === prod) {
  die([
    '⛔  .env.production points at the SAME database as .env.',
    '',
    `        ${new URL(prodUrl).username}`,
    '',
    'One of the two files is wrong. Running a `:prod` script now would do',
    'production things to your development data, or the reverse — and',
    '`db:demo:prod` and `db:clear-txn:prod` both write.',
  ]);
}

console.log(`  → production target: ${new URL(prodUrl).username}`);
