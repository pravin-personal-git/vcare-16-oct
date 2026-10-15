/**
 * Create a real PLATFORM_OWNER login.
 *
 * The demo `platform_owner` account only ever exists in dev (`seed.ts`,
 * guarded against production). There is no UI path to create the first
 * Platform Owner - by design, nothing except an existing Platform Owner can
 * grant that role, and the very first one has nobody above them to grant it -
 * so, same as `provision-prod.ts` bootstraps a database's first tenant
 * admin, this is the equivalent for the platform level. Prompts for
 * everything directly in this terminal; nothing is passed through any other
 * system.
 *
 * Does NOT refuse to run twice - a real deployment may reasonably want more
 * than one Platform Owner (see D045/§2). Prints how many already exist so
 * you don't create a duplicate by mistake.
 *
 * Run:  npm run provision:platform-owner:prod
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const db = new PrismaClient();

async function hash(plain: string) {
  const salt = randomBytes(16);
  const h = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

const userCode = (n = 6) =>
  randomBytes(n * 2).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, n);

async function main() {
  const host = (process.env.DATABASE_URL ?? '').match(/@([^:/?]+)/)?.[1] ?? 'unknown';
  console.log(`\n  Provisioning a Platform Owner on: ${host}\n`);

  const root = await db.platformAccount.findFirst({ where: { type: 'PLATFORM', parentAccountId: null } });
  if (!root) {
    console.error(
      '  No root PLATFORM account exists yet. This means the\n' +
      '  `ensure_root_platform_account` migration has not run against this\n' +
      '  database - run `npm run db:deploy:prod` first.\n',
    );
    process.exit(1);
  }

  const platformOwnerRole = await db.platformRole.findUnique({ where: { key: 'PLATFORM_OWNER' } });
  if (!platformOwnerRole) {
    console.error(
      '  The PLATFORM_OWNER role is not seeded yet. This runs automatically\n' +
      '  as part of `npm run build` (via sync-tenant-defaults.ts) - if this\n' +
      '  is a fresh deploy, wait for that build to finish first.\n',
    );
    process.exit(1);
  }

  const existingCount = await db.membership.count({ where: { platformRoleId: platformOwnerRole.id } });
  console.log(`  ${existingCount} Platform Owner(s) already exist on this database.\n`);

  const rl = createInterface({ input: stdin, output: stdout });

  const fullName = (await rl.question('  Full name: ')).trim();
  // Lowercased to match src/app/login/actions.ts and administration.ts::createUser
  // - both compare/store usernames lowercase.
  const username = (await rl.question('  Username: ')).trim().toLowerCase();
  const email = (await rl.question('  Email (optional): ')).trim();
  const password = (await rl.question('  Password (min 12 chars): ')).trim();

  rl.close();

  if (!username || !fullName) {
    console.error('\n  Name and username are required.\n');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('\n  Password must be at least 12 characters.\n');
    process.exit(1);
  }

  const clash = await db.user.findUnique({ where: { username } });
  if (clash) {
    console.error(`\n  The username "${username}" is already taken.\n`);
    process.exit(1);
  }

  console.log('\n  Working…');

  const passwordHash = await hash(password);
  const user = await db.user.create({
    data: {
      userCode: userCode(),
      organizationId: null,
      fullName,
      username,
      email: email || null,
      passwordHash,
    },
  });
  await db.membership.create({
    data: { userId: user.id, platformRoleId: platformOwnerRole.id, platformAccountId: root.id },
  });

  console.log(`\n  Done. Sign in at /login as "${username}" - you'll land on /platform.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
