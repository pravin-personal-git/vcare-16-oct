import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '../db';

/**
 * The customer portal's own session, deliberately parallel to
 * server/auth/session.ts rather than sharing it - see the comment on
 * PartyLoginSession in schema.prisma. Same mechanism (opaque DB-backed
 * token, not a JWT, so a session can be revoked - e.g. by disabling portal
 * access from the customer record), different cookie, different table.
 */

const COOKIE = 'atlas_portal_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function createPortalSession(
  partyId: string,
  opts: { userAgent?: string; ipAddress?: string } = {},
): Promise<string> {
  const token = randomBytes(32).toString('hex');

  await db.partyLoginSession.create({
    data: {
      partyId,
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
    maxAge: Math.floor(THIRTY_DAYS_MS / 1000),
  });

  return token;
}

export async function getPortalSessionToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function destroyPortalSession(): Promise<void> {
  const token = await getPortalSessionToken();
  if (token) {
    await db.partyLoginSession
      .updateMany({
        where: { sessionToken: token },
        data: { loggedOutAt: new Date(), isRevoked: true },
      })
      .catch(() => undefined);
  }
  (await cookies()).delete(COOKIE);
}
