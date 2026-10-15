import 'server-only';
import { db } from './db';
import { recordEvent } from './shop';
import { isPartyCodeClash, nextPartyCode } from './parties';

/**
 * A visitor making their own account.
 *
 * Decision 9, in Pravin's words: actions need a login, "and they should be able
 * to set their own passwords... (FROM THEIR LOCATION MANDATORY, MOBILE NUMBER
 * AND EMAIL MANDATORY)".
 *
 * ---------------------------------------------------------------------------
 * A SELF-REGISTERED PARTY IS NOT A CUSTOMER
 *
 * Every other `portal*` field is switched on by a staff member for somebody
 * who is already a customer - there is an invoice, somebody has met them, the
 * address has been visited. This is a second door, and what comes through it is
 * a stranger who typed their own details.
 *
 * `selfRegisteredAt` records that difference so it cannot be smoothed over. The
 * row is a real `Party` because it has to be - a complaint and a lead both need
 * one - but every screen that matters can tell the two apart, and nobody should
 * ever write a quotation off the back of an address nobody has checked.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not verify the mobile number. An OTP would be the right answer and is
 * not built; until it is, this is a self-declared identity and is treated as
 * one. It also does not merge with an existing customer on a matching phone
 * number - see the note on `takenBy` below.
 */

export interface RegisterInput {
  name: string;
  phone: string;
  email: string;
  /** Where they are. Mandatory, per decision 9. */
  addressLine1: string;
  city: string;
  state: string;
  password: string;
}

export interface RegisterResult {
  partyId: string;
  /** True when this reused an account that already existed. */
  existing: boolean;
}

const TEN_DIGITS = /^\d{10}$/;

export async function registerShopVisitor(
  storeId: string,
  input: RegisterInput,
  sessionKey: string,
): Promise<RegisterResult> {
  const name = input.name.trim();
  const phone = input.phone.replace(/\D/g, '').slice(-10);
  const email = input.email.trim().toLowerCase();
  const address = input.addressLine1.trim();
  const city = input.city.trim();
  const state = input.state.trim();

  if (!name) throw new Error('Tell us your name.');
  if (!TEN_DIGITS.test(phone)) throw new Error('A 10-digit mobile number, please.');
  if (!email.includes('@') || email.length < 5) throw new Error('That email address does not look right.');
  // All three mandatory, as decided. A request from somebody whose location is
  // unknown is a request nobody can price: a camera fitted forty kilometres out
  // is a different job from one fitted down the road.
  if (!address) throw new Error('We need your address to work out what a visit would cost.');
  if (!city) throw new Error('Which town or city?');
  if (!state) throw new Error('Which state?');

  // The same rules staff passwords follow. A shop login reaches invoices and
  // complaint history, so it is not a lesser kind of password.
  const { checkChosenPassword } = await import('@/lib/password-policy');
  const checked = checkChosenPassword(input.password, { fullName: name });
  if (!checked.ok) throw new Error(checked.reason);

  /**
   * SOMEBODY IS ALREADY HERE ON THIS NUMBER.
   *
   * Refused rather than merged, and that is the careful choice. A phone number
   * is the one thing a shop's customer records are matched on, so silently
   * attaching a self-declared password to an existing customer would hand a
   * stranger that customer's invoices and complaint history on the strength of
   * guessing ten digits. Nothing here verifies the number yet.
   *
   * So: tell them the account exists and send them to sign in. If it genuinely
   * is them and they have no password, the branch can set one - which puts a
   * person in the loop, which is the point.
   */
  const takenBy = await db.party.findFirst({
    where: { storeId, phone },
    select: { id: true, portalEnabled: true },
  });
  if (takenBy) {
    throw new Error(
      takenBy.portalEnabled
        ? 'There is already an account on this number. Please sign in instead.'
        : 'We already have you on this number. Please ring the branch and they will set your login up.',
    );
  }

  const { hashPassword } = await import('./auth/password');
  const portalPasswordHash = await hashPassword(input.password);

  const data = {
    storeId,
    firstName: name,
    phone,
    email,
    addressLine1: address,
    city,
    state,
    // A customer, not a supplier. They are here to buy.
    isCustomer: true,
    // The two things that make this account real, and the one that keeps it
    // honest about where it came from.
    portalEnabled: true,
    portalPasswordHash,
    // They chose it themselves, so there is nothing to force them to change.
    portalMustReset: false,
    portalActivatedAt: new Date(),
    selfRegisteredAt: new Date(),
  };

  /**
   * Retried once on a code clash.
   *
   * `nextPartyCode` reads the highest code and adds one, so two people
   * registering in the same second both read the same number and one loses on
   * the unique index. Rare, and exactly the kind of rare that happens the first
   * time a shop is advertised. One retry is enough: the loser re-reads and gets
   * the number the winner just took, plus one.
   */
  let party: { id: string };
  try {
    party = await db.party.create({
      data: { ...data, partyCode: await nextPartyCode(storeId) },
      select: { id: true },
    });
  } catch (e) {
    if (!isPartyCodeClash(e)) throw e;
    party = await db.party.create({
      data: { ...data, partyCode: await nextPartyCode(storeId) },
      select: { id: true },
    });
  }

  await recordEvent(storeId, { kind: 'register', sessionKey, partyId: party.id });
  return { partyId: party.id, existing: false };
}
