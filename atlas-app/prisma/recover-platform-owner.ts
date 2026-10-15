/**
 * Recover the `pravin04r` PLATFORM_OWNER account's password.
 *
 * D055 (single-seat hardening): this account's email can only ever be
 * verified, and its password can only ever be reset, through this
 * trusted-operator CLI script - the same trust boundary
 * `provision-platform-owner.ts` itself already assumes (production
 * database access), never through any self-service "forgot password" or
 * "edit profile" web flow, present or future. There is no such flow in
 * this app today anyway (confirmed: no route exists anywhere in
 * `src/app`), and no `EmailProvider` integration yet (spec §15) to send a
 * reset link to - this script IS the recovery path until that exists,
 * at which point it upgrades to a real emailed OTP additively, because the
 * `pravin04r@gmail.com` binding checked below is already the source of
 * truth for "is this really that account."
 *
 * Run:  npm run recover:platform-owner:prod
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const db = new PrismaClient();

const RECOVERABLE_USERNAME = 'pravin04r';
const RECOVERABLE_EMAIL = 'pravin04r@gmail.com';

async function hash(plain: string) {
  const salt = randomBytes(16);
  const h = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

async function main() {
  const host = (process.env.DATABASE_URL ?? '').match(/@([^:/?]+)/)?.[1] ?? 'unknown';
  console.log(`\n  Recovering the "${RECOVERABLE_USERNAME}" Platform Owner account on: ${host}\n`);

  const user = await db.user.findUnique({ where: { username: RECOVERABLE_USERNAME } });
  if (!user) {
    console.error(`\n  No user with username "${RECOVERABLE_USERNAME}" exists on this database.\n`);
    process.exit(1);
  }
  if (user.email !== RECOVERABLE_EMAIL) {
    // Deliberately vague about what the real email on file is - this
    // script's whole job is to refuse silently useful information to
    // anyone who doesn't already know the bound address.
    console.error(
      '\n  This account is not bound to the expected recovery email.\n'
      + '  Refusing to proceed - this script only recovers one specific,\n'
      + '  pre-bound account (D055), never a general password reset.\n',
    );
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });

  const typedEmail = (await rl.question(
    `  Type this account's current email exactly, to confirm you intend to recover it: `,
  )).trim();

  if (typedEmail !== RECOVERABLE_EMAIL) {
    rl.close();
    console.error('\n  That does not match. Refusing to proceed.\n');
    process.exit(1);
  }

  const newPassword = (await rl.question('  New password (min 12 chars): ')).trim();
  rl.close();

  if (newPassword.length < 12) {
    console.error('\n  Password must be at least 12 characters.\n');
    process.exit(1);
  }

  console.log('\n  Working…');

  const passwordHash = await hash(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // A recovery implies the operator may not trust the account's existing
    // sessions - same "a reset that leaves old sessions alive does not
    // actually lock anybody out" reasoning `administration.ts::resetUserPassword`
    // already uses for ordinary tenant users.
    db.loginSession.updateMany({
      where: { userId: user.id, isRevoked: false, loggedOutAt: null },
      data: { isRevoked: true, loggedOutAt: new Date() },
    }),
  ]);

  console.log(`\n  Done. Sign in at /login as "${RECOVERABLE_USERNAME}" with the new password.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
