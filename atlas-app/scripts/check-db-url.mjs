/**
 * Say plainly what is wrong with DATABASE_URL / DIRECT_URL, before the build
 * spends seven minutes finding out the hard way.
 *
 * Runs first in `npm run build`. The deploy of 5 Oct 2026 is why: the same
 * commit went Ready on Production and failed on Preview, and all Prisma would
 * say, after `prisma migrate deploy` had already succeeded on the OTHER url,
 * was:
 *
 *   The provided database string is invalid. The provided arguments are not
 *   supported in database URL ... certain characters must be escaped.
 *
 * That names neither the variable nor the character. This does.
 *
 * NEVER PRINTS A PASSWORD. Every message is built from the parts that are safe
 * to show: the variable name, the host, the port, the query string, the
 * Supabase project ref, and the shape of what it could not parse.
 *
 * It fails the build only on what is certainly fatal - a url that is absent,
 * that does not parse, or that still has a paste-the-password placeholder in
 * it. Anything merely suspicious is a warning, because a false positive here
 * would break a deploy that would otherwise have worked.
 */

const EXPECTED = {
  DATABASE_URL: { port: '6543', why: 'the pooled connection (PgBouncer), used at runtime' },
  DIRECT_URL: { port: '5432', why: 'the direct connection, required for migrations' },
};

/** The password, and only the password, replaced. */
function safe(raw) {
  return raw.replace(/\/\/([^:/?#]*):([^@]*)@/, (_m, user) => `//${user}:***@`);
}

const problems = [];
const warnings = [];

for (const [name, want] of Object.entries(EXPECTED)) {
  const raw = process.env[name];

  if (!raw || !raw.trim()) {
    problems.push(`${name} is not set. It must be ${want.why}.`);
    continue;
  }

  // The giveaway when a Supabase template was pasted without editing it.
  const placeholder = raw.match(/\[[^\]]*\]/);
  if (placeholder) {
    problems.push(
      `${name} still contains the placeholder ${placeholder[0]}. `
      + 'Replace it with the real value. Square brackets are not legal in a connection string, '
      + 'which is the "illegal characters" Prisma is complaining about.',
    );
    continue;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    problems.push(
      `${name} is not a valid URL. It should look like `
      + 'postgresql://USER:PASSWORD@HOST:PORT/postgres?params. '
      + `What is set starts "${raw.slice(0, 12)}..." and is ${raw.length} characters long.`,
    );
    continue;
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    problems.push(`${name} starts with "${url.protocol}" - it should be postgresql://`);
    continue;
  }

  // A raw # or ? or @ in the password silently truncates the url. If the
  // password survived parsing but the host looks wrong, that is usually why.
  if (!url.hostname) {
    problems.push(`${name} has no host. An unescaped @ or # in the password will do this.`);
    continue;
  }

  const params = url.search ? url.search.slice(1) : '(none)';
  const ref = (url.username.match(/^postgres\.([a-z0-9]+)$/) ?? [])[1] ?? null;
  const where = `${name}: host ${url.hostname}, port ${url.port || '(none)'}, params [${params}]`
    + (ref ? `, project ${ref}` : '');

  if (url.port !== want.port) {
    warnings.push(`${where}\n    expected port ${want.port} - ${want.why}.`);
  }

  if (name === 'DATABASE_URL' && !url.searchParams.has('pgbouncer')) {
    warnings.push(
      `${where}\n    has no pgbouncer=true. Through PgBouncer on 6543, Prisma needs `
      + 'pgbouncer=true&connection_limit=1 or prepared statements will fail at runtime.',
    );
  }

  if (name === 'DIRECT_URL' && url.search) {
    warnings.push(`${where}\n    the direct connection normally carries no parameters.`);
  }

  // A character the URL class accepted but a Postgres driver will not.
  const afterHost = raw.slice(raw.indexOf('@') + 1);
  const odd = afterHost.match(/[\s<>{}|\\^`]/);
  if (odd) {
    problems.push(`${name} contains ${JSON.stringify(odd[0])} after the host, which is not legal. Value: ${safe(raw)}`);
  }
}

// Both urls pointing at different projects is almost always a mistake.
const refOf = (v) => (process.env[v] ?? '').match(/postgres\.([a-z0-9]+)/)?.[1] ?? null;
const a = refOf('DATABASE_URL');
const b = refOf('DIRECT_URL');
if (a && b && a !== b) {
  problems.push(`DATABASE_URL points at project ${a} but DIRECT_URL points at ${b}. They must be the same database.`);
}

if (warnings.length) {
  console.warn('\n  Database URL warnings:');
  for (const w of warnings) console.warn(`  - ${w}`);
  console.warn('');
}

if (problems.length) {
  console.error('\n  BUILD STOPPED: the database connection string is wrong.\n');
  for (const p of problems) console.error(`  - ${p}\n`);
  console.error(
    '  Fix it in Vercel > Settings > Environment Variables, for the environment\n'
    + '  this deploy is building (Production or Preview), then redeploy. An\n'
    + '  environment variable only reaches a new build.\n\n'
    + '  Expected shape:\n'
    + '    DATABASE_URL  postgresql://postgres.<ref>:<password>@<host>:6543/postgres?pgbouncer=true&connection_limit=1\n'
    + '    DIRECT_URL    postgresql://postgres.<ref>:<password>@<host>:5432/postgres\n',
  );
  process.exit(1);
}

console.log(`  Database URLs look right${a ? ` (project ${a})` : ''}.`);
