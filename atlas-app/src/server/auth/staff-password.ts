import 'server-only';
import type { User } from '@prisma/client';
import { db } from '../db';
import { verifyPassword } from './password';

/**
 * The staff password check shared by the website and Vcare logins
 * (health check SEC-2, 25 Sep 2026).
 *
 * Five wrong passwords in a row lock the account for 15 minutes - the same
 * rule the customer portal has always had. Every failure is written to the
 * activity log with the IP, so an admin can see someone guessing. The
 * message never says whether the username exists.
 */

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;

export type StaffPasswordResult =
  | { ok: true; user: User }
  | { ok: false; error: string; status: number };

async function logEvent(user: Pick<User, 'id' | 'fullName'>, description: string, ip: string | null, activityType: string) {
  const role = await db.userStoreRole.findFirst({ where: { userId: user.id }, select: { storeId: true } });
  if (!role) return;
  await db.activityLog.create({
    data: { storeId: role.storeId, userId: user.id, activityType, entityType: 'User', entityId: user.id, description, ipAddress: ip },
  });
}

export async function checkStaffPassword(
  username: string, password: string, ip: string | null, via: 'web' | 'Vcare',
): Promise<StaffPasswordResult> {
  const user = await db.user.findUnique({ where: { username } });
  const now = Date.now();

  if (user?.loginLockedUntil && user.loginLockedUntil.getTime() > now) {
    const minutes = Math.ceil((user.loginLockedUntil.getTime() - now) / 60_000);
    return { ok: false, status: 429, error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask your administrator to reset it.` };
  }

  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, loginLockedUntil: new Date(now + LOGIN_LOCK_MS) }
          : { failedLoginCount: failed },
      }).catch(() => undefined);
      await logEvent(
        user,
        lock
          ? `${user.fullName}: sign-in locked for 15 minutes after ${MAX_FAILED_LOGINS} wrong passwords (${via})`
          : `${user.fullName}: wrong password (${via}, attempt ${failed} of ${MAX_FAILED_LOGINS})`,
        ip, lock ? 'Login Locked' : 'Login Failed',
      ).catch(() => undefined);
    }
    return { ok: false, status: 401, error: 'Incorrect username or password.' };
  }

  if (user.failedLoginCount > 0 || user.loginLockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, loginLockedUntil: null } }).catch(() => undefined);
  }
  return { ok: true, user };
}

/** Sign-out, written to the activity log (it never was before). */
export async function logSignOut(user: Pick<User, 'id' | 'fullName'>, ip: string | null, via: 'web' | 'Vcare') {
  await logEvent(user, `${user.fullName} signed out (${via})`, ip, 'Logout').catch(() => undefined);
}
