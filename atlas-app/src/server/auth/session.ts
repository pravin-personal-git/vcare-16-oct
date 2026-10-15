import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '../db';

/**
 * Sessions are stored in the database (LoginSession), not in a JWT.
 *
 * The spec requires a "User Login Sessions" screen with the ability to revoke
 * a session remotely - see 12-users-roles-permissions.md §5. You cannot revoke
 * a stateless token, so the session lives server-side and the cookie holds only
 * an opaque handle.
 */

const COOKIE = 'atlas_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
  opts: { rememberMe?: boolean; userAgent?: string; ipAddress?: string } = {},
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const maxAge = opts.rememberMe ? THIRTY_DAYS_MS : ONE_DAY_MS;

  await db.loginSession.create({
    data: {
      userId,
      sessionToken: token,
      userAgent: opts.userAgent ?? null,
      ipAddress: opts.ipAddress ?? null,
    },
  });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAge / 1000),
  });

  return token;
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function destroySession(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    await db.loginSession
      .updateMany({
        where: { sessionToken: token },
        data: { loggedOutAt: new Date(), isRevoked: true },
      })
      .catch(() => undefined);
  }
  (await cookies()).delete(COOKIE);
}
