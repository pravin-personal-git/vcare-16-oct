import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { canStoreSecrets, open, seal } from './secret-box';
import { verifyPassword } from './auth/password';

/**
 * THE ADMIN-READABLE PASSWORD COPY (Vcare, 9 Oct 2026).
 *
 * Vcare's admin asked to see staff passwords rather than reset them. Pravin
 * decided to build it after the trade-off was put to him: Atlas keeps a
 * sealed second copy beside the one-way hash. The guard rails, all of which
 * live here or in the one action that calls `readPasswordCopy`:
 *
 *   - sealed with ATLAS_SECRET_KEY, which is never in the database;
 *   - only the `users.viewPasswords` permission can read it;
 *   - the viewer re-enters their own password first (server/auth/elevation);
 *   - every view is written to the activity log, who and whose;
 *   - the copy is re-checked against `passwordHash` before it is shown.
 *
 * Login never touches this file. If the copy were lost or wrong, nobody
 * would be locked out - the admin would only be told to reset once.
 */

type Tx = Prisma.TransactionClient | typeof db;

/**
 * Keep (or replace) the sealed copy. Call it wherever a user's password is
 * set, inside the same transaction as the hash.
 *
 * Without ATLAS_SECRET_KEY nothing is stored - and any old copy is deleted,
 * because it would now describe a password that no longer works. Never
 * stores plaintext as a fallback.
 */
export async function keepPasswordCopy(tx: Tx, userId: string, plain: string): Promise<boolean> {
  if (!canStoreSecrets()) {
    await tx.userPasswordCopy.deleteMany({ where: { userId } });
    return false;
  }
  const sealed = seal(plain);
  await tx.userPasswordCopy.upsert({
    where: { userId },
    create: { userId, sealed },
    update: { sealed },
  });
  return true;
}

export type PasswordCopy =
  | { state: 'ok'; password: string; setAt: Date }
  /** Never captured: set before 9 Oct 2026, or on a path that does not keep one. */
  | { state: 'none' }
  /** The deployment has no ATLAS_SECRET_KEY, so nothing can be sealed or read. */
  | { state: 'no_key' }
  /** A copy exists but no longer matches the hash - changed somewhere that did not keep one. */
  | { state: 'stale' };

/**
 * Read one user's copy, scoped to the organisation. The CALLER checks the
 * permission and the step-up, and logs the view.
 */
export async function readPasswordCopy(organizationId: string, userId: string): Promise<PasswordCopy> {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    select: { passwordHash: true, passwordCopy: { select: { sealed: true, setAt: true } } },
  });
  if (!user) throw new Error('User not found.');
  if (!canStoreSecrets()) return { state: 'no_key' };
  if (!user.passwordCopy) return { state: 'none' };

  const plain = open(user.passwordCopy.sealed);
  // Unreadable (key changed) or out of step with the real password: either
  // way showing it would send somebody to sign in with the wrong thing.
  if (!plain || !(await verifyPassword(plain, user.passwordHash))) return { state: 'stale' };

  return { state: 'ok', password: plain, setAt: user.passwordCopy.setAt };
}
