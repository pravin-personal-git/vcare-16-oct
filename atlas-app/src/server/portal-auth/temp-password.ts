import { randomInt } from 'node:crypto';

/**
 * A one-time password a staff member reads out or shares with a customer.
 *
 * Excludes visually ambiguous characters (0/O, 1/I/l) - this is read over a
 * phone call or copied off a screen by hand, not typed by a machine. 10
 * characters from a 32-symbol alphabet is ~50 bits of entropy, comfortably
 * enough for a credential that is forced to be replaced on first use.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTempPassword(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
