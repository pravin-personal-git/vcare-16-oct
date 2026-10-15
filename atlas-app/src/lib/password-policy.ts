/**
 * PASSWORDS - what Atlas will and will not do with them (3 Oct 2026).
 *
 * ## Why an administrator cannot see anybody's password
 *
 * The request was for a screen showing each employee's password, so an admin
 * would not have to keep resetting them by hand. The second half of that is a
 * real problem and this module fixes it. The first half is not possible, and it
 * is worth writing down why rather than leaving it as a refusal.
 *
 * `User.passwordHash` is a scrypt hash: a one-way fingerprint with a random
 * salt. Verifying a password means hashing what was typed and comparing; there
 * is no direction that runs backwards. So there is no password in the database
 * to show - not hidden behind a permission, not encrypted, simply not there.
 *
 * Storing them reversibly instead would mean one database leak handing an
 * attacker every employee's password in plain text. People reuse passwords on
 * their bank and their email, so the damage would not stop at Atlas. It would
 * also make the business liable in a way a hash does not: under DPDP 2023, a
 * breach of reversible credentials for every employee is a different
 * conversation from a breach of hashes.
 *
 * ## What replaces it
 *
 * An admin presses Reset. Atlas generates a strong password, shows it ONCE on
 * screen, revokes the person's sessions, and flags the account so that password
 * works exactly long enough to sign in and is then replaced by one only that
 * person knows. The admin never invents or types a password, which was the
 * actual complaint, and nothing readable is ever stored.
 *
 * Alongside it the users screen gained a status column - last signed in, never
 * signed in, locked out, reset pending - because "can this person get in?" is
 * usually the question behind "what is their password?", and Atlas could not
 * answer it before.
 */

/**
 * The alphabet a generated password is built from.
 *
 * `0/O`, `1/l/I` and `5/S` are left out on purpose. These are read down a phone
 * line and typed by somebody who did not choose them - an ambiguous character
 * costs a failed login and a second phone call, and a failed login counts
 * toward the five that lock the account for fifteen minutes.
 *
 * No punctuation, for the same reason: "hyphen, lower-case..." over a bad line
 * is where this goes wrong, and length buys far more strength than symbols do.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Four groups of four - `K7mq-Rt4v-nPz9-Bx2k`. Readable aloud, 16 characters. */
const GROUPS = 4;
const GROUP_LEN = 4;

/** Atlas's own floor. Below this a password is refused wherever it is set. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * A strong temporary password, from a cryptographic source.
 *
 * `randomInt` rather than `Math.random()`: a predictable temporary password is
 * worse than a weak chosen one, because it is issued to somebody with a real
 * role and sits unused in an inbox or on a notepad until they get round to
 * signing in.
 *
 * Rejection-sampled by `randomInt` itself, so there is no modulo bias - every
 * character of the alphabet is equally likely, which is the whole basis of the
 * strength claim below.
 */
export function generatePassword(
  randomInt: (maxExclusive: number) => number,
): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)]!;
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LEN }, pick).join('')).join('-');
}

/**
 * Whether a password a PERSON chose is acceptable.
 *
 * Deliberately short rules. Long composition requirements (one upper, one
 * digit, one symbol, no repeats) are well known to push people toward
 * `Password1!` and a sticky note, which is worse than a long passphrase they
 * can actually remember. Length is the thing that matters and it is the thing
 * this insists on.
 */
export function checkChosenPassword(password: string, context: {
  username?: string | null;
  fullName?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const p = password.trim();

  if (p.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Use at least ${MIN_PASSWORD_LENGTH} characters. A longer phrase you can remember `
        + 'is stronger than a short one with symbols in it.',
    };
  }
  if (p !== password) {
    // A password with a space at either end is a password somebody will fail to
    // type tomorrow, and they will have no idea why.
    return { ok: false, reason: 'Do not start or end with a space.' };
  }

  const lower = p.toLowerCase();
  const name = (context.fullName ?? '').trim().toLowerCase();
  const user = (context.username ?? '').trim().toLowerCase();

  if (user.length >= 4 && lower.includes(user)) {
    return { ok: false, reason: 'Do not put your username in your password.' };
  }
  for (const part of name.split(/\s+/).filter((w) => w.length >= 4)) {
    if (lower.includes(part)) {
      return { ok: false, reason: 'Do not put your own name in your password.' };
    }
  }

  // The handful that get tried first by anything attacking a login form. Not a
  // dictionary - a dictionary check belongs behind a service, and a short list
  // of the obvious ones catches what people actually type when told to hurry.
  const OBVIOUS = [
    'password', '12345678', 'qwerty', 'welcome', 'letmein', 'admin',
    'atlas', 'maalik', 'changeme', 'iloveyou', 'abcd1234',
  ];
  if (OBVIOUS.some((o) => lower.includes(o))) {
    return { ok: false, reason: 'That is one of the first passwords anybody tries. Pick something else.' };
  }

  return { ok: true };
}

/* ------------------------------------------------------- what an admin sees */

export type AccessState =
  | 'never_signed_in'
  | 'reset_pending'
  | 'locked_out'
  | 'inactive'
  | 'active';

export interface AccessSubject {
  isActive: boolean;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  loginLockedUntil: Date | null;
  failedLoginCount: number;
}

/**
 * "Can this person get in, and if not why not" - in one word.
 *
 * The question an admin is really asking when they ask to see a password. Atlas
 * had every one of these facts and showed none of them, so the only way to find
 * out whether somebody could sign in was to reset their password and ask.
 *
 * Order matters: inactive beats everything (they cannot sign in at all), then a
 * lockout (temporary and self-clearing), then a pending reset, then whether
 * they have ever been in.
 */
export function accessState(u: AccessSubject, now: Date = new Date()): AccessState {
  if (!u.isActive) return 'inactive';
  if (u.loginLockedUntil && u.loginLockedUntil.getTime() > now.getTime()) return 'locked_out';
  if (u.mustChangePassword) return 'reset_pending';
  if (!u.lastLoginAt) return 'never_signed_in';
  return 'active';
}

export const ACCESS_LABEL: Record<AccessState, string> = {
  never_signed_in: 'Never signed in',
  reset_pending: 'Must set a new password',
  locked_out: 'Locked out',
  inactive: 'Account switched off',
  active: 'Signing in normally',
};

export const ACCESS_TONE: Record<AccessState, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  never_signed_in: 'info',
  reset_pending: 'warning',
  locked_out: 'danger',
  inactive: 'neutral',
  active: 'success',
};

/** The sentence under the badge - what to do about it, not what it is. */
export function accessHint(u: AccessSubject, now: Date = new Date()): string | null {
  const state = accessState(u, now);
  switch (state) {
    case 'locked_out': {
      const mins = Math.max(1, Math.ceil(((u.loginLockedUntil?.getTime() ?? 0) - now.getTime()) / 60_000));
      return `${u.failedLoginCount} wrong passwords. Clears in ${mins} minute${mins === 1 ? '' : 's'}, `
        + 'or reset their password to clear it now.';
    }
    case 'reset_pending':
      return 'You reset their password. They will be asked to choose their own the next time they sign in.';
    case 'never_signed_in':
      return 'They have an account but have never used it. Check they have the right username.';
    case 'inactive':
      return 'Switched off - they cannot sign in. Reactivate them on this screen.';
    case 'active':
      return null;
  }
}
