import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A link to one attachment that can go on WhatsApp (11 Oct 2026).
 *
 * The bucket is private and its signed links last ten minutes - too short for
 * a customer who opens the chat an hour later. So the WhatsApp message carries
 * a link to our own route with a signed token (file id + expiry, HMAC with the
 * session secret). Opening it mints a fresh ten-minute storage link and
 * redirects. Nothing is stored: the token proves itself, and it simply stops
 * working after SHARE_DAYS.
 */
const SHARE_DAYS = 7;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set - needed to share a file link.');
  return s;
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function shareToken(attachmentId: string, now = Date.now()): string {
  const payload = `${attachmentId}.${now + SHARE_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload)}`;
}

/** The attachment id when the token is genuine and in date, else null. */
export function readShareToken(token: string, now = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, mac] = parts;
  const want = Buffer.from(sign(`${id}.${exp}`));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (!(Number(exp) > now)) return null;
  return id;
}

export const SHARE_LINK_DAYS = SHARE_DAYS;
