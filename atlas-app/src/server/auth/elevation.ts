import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '../db';
import { verifyPassword } from './password';

/**
 * God-mode reauth elevation (superadmin-roadmap D054).
 *
 * Re-entering the current password establishes a short-lived (~15 minute)
 * elevated-session marker, required immediately before the most dangerous
 * platform actions: Access Tenant (Slice 5), credential reset (Slice 7),
 * and lifecycle changes (Slice 6). The *initial* login still goes through
 * the ordinary username/password flow in `login/actions.ts` - this is an
 * extra gate on top of an already-authenticated session, not a
 * replacement for it.
 *
 * A signed, short-lived cookie - not a `LoginSession`-adjacent table - per
 * D054/§6: "No schema change is needed for the reauth marker... a signed,
 * short-lived elevation token (cookie or in-memory-adjacent, ~15 minutes),
 * separate from the LoginSession row, not a new table." Unlike
 * `ImpersonationSession` (which genuinely needs to be revocable and
 * queryable - see that model's own comment on why it's DB-backed instead),
 * an elevation marker only ever needs to answer one question, for one
 * request, from one server: "did THIS user prove their password again,
 * recently enough?" - exactly what an HMAC-signed, self-verifying cookie
 * answers without a round trip, and it expires on its own with no
 * revocation story to build.
 */

const COOKIE = 'atlas_elevated';
const TTL_MS = 15 * 60_000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set - required for god-mode reauth elevation.');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

/** Called after `verifyPassword` succeeds against the acting user's own current password. */
export async function grantElevation(userId: string): Promise<void> {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  const value = `${payload}.${sign(payload)}`;

  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

/** True only if `userId` itself re-entered its password within the last ~15 minutes. */
export async function isElevated(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;

  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  const [uid, expiresAtStr, sig] = parts;

  const payload = `${uid}.${expiresAtStr}`;
  const expected = Buffer.from(sign(payload), 'hex');
  const actual = Buffer.from(sig, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  if (uid !== userId) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;

  return true;
}

/**
 * Explicit invalidation - not called automatically after a single gated
 * action. The whole point of the ~15 minute window is to cover several
 * actions in one sitting (e.g. Access Tenant, then a credential reset
 * inside it) without re-prompting for the password each time. Called on
 * `logout()` so the marker never outlives the session it was granted in.
 */
export async function clearElevation(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * Shared "am I elevated, and if not, does this password prove it" check for
 * Slice 7+ god-mode actions - factored out after `app/actions/impersonation.ts`'s
 * `startTenantAccessAction` first wrote this exact sequence out by hand.
 * Returns an error string to surface to the caller, or `null` on success
 * (already elevated, or just proved it and the window is now (re-)granted).
 */
export async function ensureElevated(userId: string, password: string): Promise<string | null> {
  if (await isElevated(userId)) return null;
  if (!password) return 'Enter your password to continue.';

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return 'Incorrect password.';

  await grantElevation(userId);
  return null;
}
