import 'server-only';
import { cache } from 'react';
import { db } from './db';
import { requestIp, setActor } from './audit-context';
import { getPortalSessionToken } from './portal-auth/session';

export interface PortalContext {
  party: {
    id: string;
    storeId: string;
    displayName: string;
    phone: string;
    email: string | null;
    portalMustReset: boolean;
  };
  store: { id: string; name: string; branchCode: string };
  organization: {
    name: string;
    themeTokens: unknown;
    logoPath: string | null;
    faviconPath: string | null;
  };
}

const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;

/**
 * The portal's analogue of server/context.ts::getContext - but a customer
 * belongs to exactly one Party in exactly one Store, so there is no scope
 * resolution, no role union, no menu tree. Just "who is this, and which
 * store's data may they see."
 */
export const getPortalContext = cache(async (): Promise<PortalContext | null> => {
  try {
    const ctx = await loadPortalContext();
    if (ctx) {
      await setActor({
        id: ctx.party.id, name: ctx.party.displayName, kind: 'party', via: 'portal',
        ip: await requestIp(), storeId: ctx.party.storeId,
      });
    }
    return ctx;
  } catch (err) {
    console.error('[portal-context] resolution failed', err);
    return null;
  }
});

async function loadPortalContext(): Promise<PortalContext | null> {
  const token = await getPortalSessionToken();
  if (!token) return null;

  const session = await db.partyLoginSession.findUnique({
    where: { sessionToken: token },
    include: { party: true },
  });

  if (!session || session.isRevoked || session.loggedOutAt) return null;

  const party = session.party;
  if (!party.portalEnabled) return null;

  // Party has no `store` relation (a plain storeId scalar, like every other
  // transactional table) - resolved as its own query rather than adding one,
  // since a back-relation on the busiest model in the schema would show up
  // in every existing Party query's autocomplete for a need only this file has.
  const store = await db.store.findUnique({
    where: { id: party.storeId },
    include: { organization: true },
  });
  if (!store) return null;

  if (Date.now() - session.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
    void db.partyLoginSession
      .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    party: {
      id: party.id,
      storeId: party.storeId,
      displayName: party.companyName || [party.firstName, party.lastName].filter(Boolean).join(' '),
      phone: party.phone,
      email: party.email,
      portalMustReset: party.portalMustReset,
    },
    store: { id: store.id, name: store.name, branchCode: store.branchCode },
    organization: {
      name: store.organization.name,
      themeTokens: store.organization.themeTokens,
      logoPath: store.organization.logoPath,
      faviconPath: store.organization.faviconPath,
    },
  };
}

export async function requirePortalContext(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (!ctx) throw new Error('PORTAL_UNAUTHENTICATED');
  return ctx;
}
