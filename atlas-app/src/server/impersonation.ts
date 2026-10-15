import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';

/**
 * "Access Tenant" (superadmin-roadmap Slice 5, spec §8) - a Platform/
 * Reseller user viewing/acting within a tenant's scope. See the schema
 * comment on `ImpersonationSession` for why this is DB-backed rather than
 * a signed cookie (unlike the reauth elevation marker in `auth/elevation.ts`,
 * which genuinely doesn't need to be revocable or queryable - this does).
 *
 * `context.ts` is the only other file that reads this table - it resolves
 * an active session into the SAME `StoreScope`/`resolveScope()` shape every
 * ordinary tenant login already produces, so none of the ~84 existing
 * `scopeWhere()` call sites need to know or care that the caller is
 * impersonating.
 */

const COOKIE = 'atlas_impersonation';
const MAX_SESSION_MS = 24 * 60 * 60_000; // a hard backstop, not the normal way this ends

export class ImpersonationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpersonationError';
  }
}

export interface ActiveImpersonation {
  organizationId: string;
  eventId: string;
}

/** Reads the cookie and confirms it names a still-active session for THIS acting user. */
export async function resolveActiveImpersonation(actingUserId: string): Promise<ActiveImpersonation | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const session = await db.impersonationSession.findFirst({
    where: { token, actingUserId, endedAt: null },
    select: { organizationId: true, eventId: true },
  });
  return session;
}

/**
 * Starts Access Tenant. Caller (the server action) is responsible for:
 * confirming the acting user's `PlatformScope` actually covers
 * `organizationId` (a Reseller must never reach a tenant outside their own
 * subtree), and confirming the god-mode reauth elevation (D054) is active -
 * neither check belongs inside this function, which only knows how to
 * write the audit row and the session, not who is allowed to call it.
 */
export async function startTenantAccess(
  actingUserId: string,
  organizationId: string,
  reason: string,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new ImpersonationError('A reason is required to access a tenant.');

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new ImpersonationError('Tenant not found.');

  const token = randomBytes(32).toString('hex');

  await db.$transaction(async (tx) => {
    const event = await tx.privilegedAccessEvent.create({
      data: {
        actingUserId,
        actionType: 'ACCESS_TENANT',
        organizationId,
        reason: trimmedReason,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    await tx.impersonationSession.create({
      data: { token, actingUserId, organizationId, eventId: event.id },
    });
  });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(MAX_SESSION_MS / 1000),
  });
}

/** "Return to Platform" - ends the session and closes its audit event. Safe to call with no active session. */
export async function endTenantAccess(): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) {
    const session = await db.impersonationSession.findUnique({ where: { token } });
    if (session && !session.endedAt) {
      const now = new Date();
      await db.$transaction([
        db.impersonationSession.update({ where: { id: session.id }, data: { endedAt: now } }),
        db.privilegedAccessEvent.update({ where: { id: session.eventId }, data: { endedAt: now } }),
      ]);
    }
  }
  (await cookies()).delete(COOKIE);
}
