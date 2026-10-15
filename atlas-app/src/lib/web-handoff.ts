import { createHash, randomBytes } from 'node:crypto';

/**
 * The one-time code behind "open the website, signed in, inside the app".
 * Pure pieces only - the database side is server/auth/web-handoff.ts.
 */

/** Two minutes: long enough for a slow phone to open the page, too short to be worth stealing. */
export const HANDOFF_TTL_MS = 2 * 60_000;

export function newHandoffCode(): string {
  return randomBytes(32).toString('base64url');
}

export function hashHandoffCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** A code as it arrives in a URL - reject anything that is not the shape we issue before touching the database. */
export function isHandoffCodeShape(code: string | null): code is string {
  return !!code && /^[A-Za-z0-9_-]{43}$/.test(code);
}

/**
 * The page to open after the handoff (a tapped phone notification, 27 Sep
 * 2026) - a path on this site only: one leading slash, no scheme, no
 * "//host", nothing but path and query characters. Anything else = null.
 */
export function safeNextPath(v: unknown): string | null {
  return typeof v === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(v) && v.length <= 300 ? v : null;
}
