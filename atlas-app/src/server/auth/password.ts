import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/**
 * Password hashing with scrypt - built into Node, no native module to compile.
 * Format: scrypt$<salt-hex>$<hash-hex>
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), KEYLEN);

  // Constant-time - a length mismatch must not short-circuit either.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
