import 'server-only';
import { db } from '../db';
import { verifyPassword } from '../auth/password';

/**
 * Shared password-check for the customer portal - factored out of
 * `app/portal/login/actions.ts` (the existing cookie-based web login) so the
 * new token-based `/api/v1/auth/customer-login` route (mobile) enforces the
 * exact same lockout/attempt rules instead of a second, hand-copied version
 * that could drift from the original.
 */

export class PortalCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalCredentialsError';
  }
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface PortalParty {
  id: string;
  firstName: string;
  lastName: string | null;
  companyName: string | null;
  phone: string;
  email: string | null;
}

/**
 * Phone is not scoped to a store here on purpose - the customer does not
 * know which store/tenant their account lives under. Collisions across
 * portal-enabled parties sharing a phone are blocked at enable-time
 * (`app/(app)/customers/actions.ts`), so at most one enabled account can
 * ever match here.
 */
export async function verifyPortalCredentials(phone: string, password: string): Promise<PortalParty> {
  const party = await db.party.findFirst({ where: { phone, portalEnabled: true } });
  if (!party) throw new PortalCredentialsError('Incorrect phone number or password.');

  if (party.portalLockedUntil && party.portalLockedUntil > new Date()) {
    const minutes = Math.ceil((party.portalLockedUntil.getTime() - Date.now()) / 60_000);
    throw new PortalCredentialsError(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const ok = party.portalPasswordHash ? await verifyPassword(password, party.portalPasswordHash) : false;
  if (!ok) {
    const failedLogins = party.portalFailedLogins + 1;
    await db.party.update({
      where: { id: party.id },
      data: {
        portalFailedLogins: failedLogins,
        ...(failedLogins >= MAX_FAILED_ATTEMPTS
          ? { portalLockedUntil: new Date(Date.now() + LOCKOUT_MS), portalFailedLogins: 0 }
          : {}),
      },
    }).catch(() => undefined);
    throw new PortalCredentialsError('Incorrect phone number or password.');
  }

  await db.party.update({
    where: { id: party.id },
    data: { portalFailedLogins: 0, portalLockedUntil: null },
  }).catch(() => undefined);

  return {
    id: party.id, firstName: party.firstName, lastName: party.lastName,
    companyName: party.companyName, phone: party.phone, email: party.email,
  };
}

export interface PortalBusinessChoice { partyId: string; businessName: string; branchName: string }

/**
 * Vcare customer sign-in, where one phone number can be a customer of
 * several businesses on the platform. The password is checked against every
 * portal account on that number; if it opens more than one, the phone is
 * handed the list to pick from and signs in again with `partyId`. Failed
 * attempts count against every account on the number, so a picker is never
 * a way around the lockout.
 */
export async function verifyPortalLogin(
  phone: string, password: string, partyId?: string | null,
): Promise<{ party: PortalParty & { mustReset: boolean } } | { choices: PortalBusinessChoice[] }> {
  const candidates = await db.party.findMany({
    where: { phone, portalEnabled: true, ...(partyId ? { id: partyId } : {}) },
    take: 20,
  });
  if (candidates.length === 0) throw new PortalCredentialsError('Incorrect phone number or password.');

  const now = new Date();
  const open = candidates.filter((p) => !(p.portalLockedUntil && p.portalLockedUntil > now));
  if (open.length === 0) {
    const until = Math.min(...candidates.map((p) => p.portalLockedUntil!.getTime()));
    const minutes = Math.ceil((until - Date.now()) / 60_000);
    throw new PortalCredentialsError(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const matched = [];
  for (const p of open) {
    if (p.portalPasswordHash && await verifyPassword(password, p.portalPasswordHash)) matched.push(p);
  }

  if (matched.length === 0) {
    await Promise.all(open.map((p) => {
      const failed = p.portalFailedLogins + 1;
      return db.party.update({
        where: { id: p.id },
        data: {
          portalFailedLogins: failed,
          ...(failed >= MAX_FAILED_ATTEMPTS ? { portalLockedUntil: new Date(Date.now() + LOCKOUT_MS), portalFailedLogins: 0 } : {}),
        },
      }).catch(() => undefined);
    }));
    throw new PortalCredentialsError('Incorrect phone number or password.');
  }

  await db.party.updateMany({
    where: { id: { in: matched.map((p) => p.id) } },
    data: { portalFailedLogins: 0, portalLockedUntil: null },
  }).catch(() => undefined);

  if (matched.length > 1) {
    const stores = new Map((await db.store.findMany({
      where: { id: { in: matched.map((p) => p.storeId) } },
      select: { id: true, name: true, organization: { select: { name: true } } },
    })).map((st) => [st.id, st]));
    return {
      choices: matched.map((p) => ({
        partyId: p.id,
        businessName: stores.get(p.storeId)?.organization.name ?? '',
        branchName: stores.get(p.storeId)?.name ?? '',
      })),
    };
  }
  const p = matched[0];
  return {
    party: {
      id: p.id, firstName: p.firstName, lastName: p.lastName, companyName: p.companyName,
      phone: p.phone, email: p.email, mustReset: p.portalMustReset,
    },
  };
}
