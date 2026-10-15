/**
 * reset-password.mjs — recover access to an Atlas account.
 *
 * Atlas does NOT use Supabase Auth (decision D016). Users live in the
 * application's own "User" table and passwords are scrypt hashes in the
 * format  scrypt$<salt-hex>$<hash-hex>  (see src/server/auth/password.ts).
 * That means you cannot reset a password from the Supabase dashboard UI —
 * Supabase has no idea these are users. You generate the hash here and
 * write it with one UPDATE.
 *
 * Usage:
 *
 *   # 1. Who exists?  (prints usernames, no passwords)
 *   node scripts/reset-password.mjs --list
 *   node scripts/reset-password.mjs --list --prod
 *
 *   # 2. Just print a hash to paste into the Supabase SQL editor
 *   node scripts/reset-password.mjs --hash 'MyNewPassword123'
 *
 *   # 3. Or set it directly against the database
 *   node scripts/reset-password.mjs --user gurjeet --password 'MyNewPassword123'
 *   node scripts/reset-password.mjs --user gurjeet --password 'MyNewPassword123' --prod
 *
 * --prod reads .env.production instead of .env.
 */

import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const scrypt = promisify(_scrypt);
const KEYLEN = 64;

async function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// ---- args -----------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const isProd = has('prod');
const envFile = isProd ? '.env.production' : '.env';

// ---- hash-only mode: no database needed ------------------------------------

if (has('hash')) {
  const plain = flag('hash');
  if (!plain) {
    console.error('  --hash needs a password.');
    process.exit(1);
  }
  const h = await hashPassword(plain);
  console.log(`
  scrypt hash generated. Paste this into the Supabase SQL editor:

    UPDATE "User"
       SET "passwordHash" = '${h}',
           "isActive"     = true
     WHERE username = 'YOUR_USERNAME';

  Then sign in with the password you just hashed.
`);
  process.exit(0);
}

// ---- everything below needs a database connection --------------------------

function loadEnv(file) {
  let text;
  try {
    text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  } catch {
    console.error(`
  Cannot read ${file}.

  Either create it, or use hash-only mode which needs no database:
    node scripts/reset-password.mjs --hash 'MyNewPassword123'
`);
    process.exit(1);
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv(envFile);

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();

const target = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
const host = target.match(/@([^/:]+)/)?.[1] ?? 'unknown host';
console.log(`\n  Environment: ${isProd ? 'PRODUCTION' : 'development'}  (${envFile})`);
console.log(`  Database:    ${host}\n`);

try {
  if (has('list')) {
    const users = await db.user.findMany({
      select: {
        userCode: true, fullName: true, username: true,
        email: true, isActive: true, lastLoginAt: true,
        storeRoles: { select: { role: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (users.length === 0) {
      console.log('  No users in this database. Run `npm run provision:prod`.\n');
    } else {
      console.log(`  ${users.length} user(s):\n`);
      for (const u of users) {
        const roles = u.storeRoles.map((r) => r.role.name).join(', ') || 'no role';
        console.log(`    username: ${u.username}`);
        console.log(`    name:     ${u.fullName}`);
        console.log(`    email:    ${u.email ?? '—'}`);
        console.log(`    roles:    ${roles}`);
        console.log(`    active:   ${u.isActive}`);
        console.log(`    last in:  ${u.lastLoginAt?.toISOString() ?? 'never'}`);
        console.log('');
      }
      console.log('  Passwords are one-way hashes. They cannot be read back — only replaced.\n');
    }
    process.exit(0);
  }

  const username = flag('user');
  const password = flag('password');

  if (!username || !password) {
    console.error(`
  Usage:
    node scripts/reset-password.mjs --list
    node scripts/reset-password.mjs --hash 'NewPassword123'
    node scripts/reset-password.mjs --user <username> --password 'NewPassword123' [--prod]
`);
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('\n  Password must be at least 12 characters.\n');
    process.exit(1);
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (!existing) {
    console.error(`\n  No user named "${username}". Run --list to see who exists.\n`);
    process.exit(1);
  }

  await db.user.update({
    where: { username },
    data: { passwordHash: await hashPassword(password), isActive: true },
  });

  console.log(`  Password reset for "${username}" and the account set active.\n`);
} finally {
  await db.$disconnect();
}
