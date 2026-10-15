import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { coordsFromMapLink, validateSite, type SiteInput } from '@/lib/sites';

/**
 * A customer's named sites (Phase 5).
 *
 * Rules are in lib/sites; this reads and writes rows. Coordinates are derived
 * from the map link at save time and stored, because a complaint dispatched to
 * a site needs them without re-parsing a link on every screen - and they are
 * recomputed whenever the link changes, so they cannot drift from it.
 */

export class SiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteError';
  }
}

export interface SiteRow {
  id: string;
  partyId: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  address: string | null;
  mapLink: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  complaintCount: number;
}

export async function listSites(scope: StoreScope, partyId: string): Promise<SiteRow[]> {
  const rows = await db.partySite.findMany({
    where: { ...scopeWhere(scope), partyId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true, partyId: true, name: true, contactName: true, contactPhone: true, address: true,
      mapLink: true, latitude: true, longitude: true, isActive: true,
      _count: { select: { complaints: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    latitude: r.latitude !== null ? r.latitude.toNumber() : null,
    longitude: r.longitude !== null ? r.longitude.toNumber() : null,
    complaintCount: r._count.complaints,
  }));
}

export async function saveSite(
  scope: StoreScope,
  partyId: string,
  input: SiteInput,
  siteId?: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const party = await db.party.findFirst({ where: { id: partyId, storeId }, select: { id: true } });
  if (!party) throw new SiteError('That customer is not in your scope.');

  const others = await db.partySite.findMany({
    where: { storeId, partyId, isActive: true, ...(siteId ? { id: { not: siteId } } : {}) },
    select: { name: true },
  });
  const bad = validateSite(input, others.map((o) => o.name));
  if (bad) throw new SiteError(bad);

  const coords = coordsFromMapLink(input.mapLink);
  const data = {
    name: input.name.trim(),
    contactName: input.contactName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    address: input.address?.trim() || null,
    mapLink: input.mapLink?.trim() || null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };

  if (siteId) {
    const { count } = await db.partySite.updateMany({ where: { id: siteId, storeId, partyId }, data });
    if (count === 0) throw new SiteError('That site no longer exists.');
  } else {
    await db.partySite.create({ data: { storeId, partyId, ...data } });
  }
}

/** Retire a site. Never deleted: complaints raised at it still point at it. */
export async function setSiteActive(scope: StoreScope, siteId: string, isActive: boolean): Promise<void> {
  const storeId = scopeForWrite(scope);
  const { count } = await db.partySite.updateMany({ where: { id: siteId, storeId }, data: { isActive } });
  if (count === 0) throw new SiteError('That site is not in your scope.');
}
