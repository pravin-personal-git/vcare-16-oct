import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Encrypting a client's third-party credential at rest (workstream D, 1 Oct 2026).
 *
 * WHY THIS EXISTS, AND WHY IT DOES NOT CONTRADICT AGENTS.md SECTION 6.
 *
 * F2.5 was emphatic that a vendor password is never stored in Atlas: the
 * biometric connector keeps it in a file on the client's own PC, and
 * `assertNoSecrets` throws rather than letting one reach the database.
 *
 * Email and WhatsApp are genuinely different and the difference is worth
 * stating rather than quietly ignoring. Those providers are called from OUR
 * server, on behalf of the client, in a multi-tenant deployment. There is no
 * client-side process to hold the key, and a Vercel environment variable is
 * per-deployment, not per-business - so one client's key would be readable by
 * every other client's requests. The key has to live with the tenant row.
 *
 * So the rule becomes: a secret may be stored only encrypted, only when the
 * server itself must present it, and never in a form a database dump or a
 * `SELECT *` during a support call reveals.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt
 * rather than silently producing rubbish that gets sent to an API as a
 * credential.
 *
 * THE MASTER KEY IS AN ENVIRONMENT VARIABLE AND MUST NOT BE LOST.
 *
 * `ATLAS_SECRET_KEY`. Without it, stored credentials cannot be read and every
 * client has to paste theirs again - recoverable, but a bad afternoon. It is
 * never written to the database, so a stolen dump is ciphertext and nothing
 * else.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
/** Marks the format, so a later change can be told apart from this one. */
const PREFIX = 'v1';

export class SecretUnavailableError extends Error {}

function masterKey(): Buffer | null {
  const raw = process.env.ATLAS_SECRET_KEY;
  if (!raw || raw.length < 16) return null;
  // Hashed to exactly 32 bytes, so any sufficiently long passphrase works and
  // the operator is not made to generate base64 of an exact length.
  return createHash('sha256').update(raw).digest();
}

/** Whether this deployment can store secrets at all. */
export const canStoreSecrets = (): boolean => masterKey() !== null;

/**
 * Encrypt. Returns `v1:<iv>:<tag>:<ciphertext>`, all base64url.
 *
 * Throws when no master key is set, rather than storing plaintext. Silently
 * degrading to an unencrypted value is how a credential ends up readable in a
 * backup, and the caller can give a clear message instead.
 */
export function seal(plain: string): string {
  const key = masterKey();
  if (!key) {
    throw new SecretUnavailableError(
      'This Atlas is not set up to store credentials. Set ATLAS_SECRET_KEY on the server first.',
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}

/**
 * Decrypt. Returns null for anything that is not a valid sealed value.
 *
 * Null rather than throwing: a credential that cannot be read means the
 * channel is not configured, which every caller already handles. Taking a
 * page down because one tenant's key is unreadable would be worse.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const key = masterKey();
  if (!key) return null;

  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const data = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, or the value was tampered with. Either way it is not a
    // credential we can use.
    return null;
  }
}

/**
 * What to show on screen instead of the secret.
 *
 * Never the first characters: for most API keys the prefix is the part that
 * identifies the account, and a screenshot of a settings page is a thing
 * people paste into chat.
 */
export function maskSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const plain = open(sealed);
  if (!plain) return 'Set (cannot be read with this key)';
  return `Set, ending ${plain.slice(-4)}`;
}
