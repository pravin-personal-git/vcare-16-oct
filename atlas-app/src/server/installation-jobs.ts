import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError } from './complaints';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { fieldSetup } from './custom-fields';
import { stdRequired, stdShown } from '@/lib/custom-fields';
import { freeOrderLines } from '@/lib/installation-stages';

/**
 * Installation jobs from a sales order.
 *
 * G-21 (10 Oct 2026): "Create installation job" made a COMPLAINT of type
 * installation, so a fitting sat in the complaints list, never appeared under
 * Installations, and "New installation" in Schedule a visit could not find it.
 * An installation is an INSTALLATION CHALLAN - the work slip the technician
 * fits from, with the order's lines on it. It is what this now makes; the
 * site the office captures (pin and words) goes on the challan. Installation
 * jobs raised the old way stay as they are and are still found here, so an
 * order never gets a second job by accident.
 */

export interface InstallationSetup {
  orderNo: string;
  customerName: string;
  /**
   * The order's lines, each with the installation already fitting it (11 Oct
   * 2026, Pravin: "a sales order can create multiple installation jobs if
   * multiple products"). A line belongs to one installation; only free lines
   * can go on a new one.
   */
  items: { id: string; productId: string | null; productName: string; qty: number; coveredBy: { id: string; number: string } | null }[];
  /** Installations already made for this order. */
  installations: { id: string; number: string; stage: string; href: string }[];
  /** The customer's saved sites that have a location. */
  sites: { id: string; name: string; address: string | null; lat: number; lng: number }[];
  /**
   * An older complaint-style installation job still open for this order -
   * those covered the whole order, so nothing more can be raised beside one.
   */
  openJob: { id: string; number: string; href: string } | null;
  /**
   * Must a location be given? Follows Settings > Custom Fields > Complaints >
   * "Site location (GPS pin)" - the same rule a complaint uses (5 Oct 2026).
   */
  locationRequired: boolean;
}

async function locationRequired(scope: StoreScope): Promise<boolean> {
  const rules = await fieldSetup(scope, 'complaint');
  return stdShown(rules, 'siteLocation') && stdRequired(rules, 'siteLocation');
}

export async function installationSetup(scope: StoreScope, salesOrderId: string): Promise<InstallationSetup> {
  const so = await db.salesOrder.findFirst({
    where: { id: salesOrderId, ...scopeWhere(scope) },
    select: {
      orderNo: true, partyId: true,
      party: { select: { companyName: true, firstName: true, lastName: true } },
      items: { select: { id: true, productId: true, productName: true, qty: true } },
      installationJobs: { where: { status: { notIn: ['closed', 'cancelled'] } }, select: { id: true, complaintNo: true }, take: 1 },
      installationChallans: {
        where: { deletedAt: null }, orderBy: { dispatchedAt: 'asc' },
        select: { id: true, challanNo: true, stage: true, items: { select: { salesOrderItemId: true, productId: true, productName: true } } },
      },
    },
  });
  if (!so) throw new ComplaintError('That order is not in your scope.');
  if (!so.partyId || !so.party) throw new ComplaintError('This order has no customer - add one before raising an installation.');
  const sites = await db.partySite.findMany({
    where: { ...scopeWhere(scope), partyId: so.partyId, isActive: true, latitude: { not: null }, longitude: { not: null } },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
    orderBy: { name: 'asc' }, take: FEED_MAX_ROWS,
  });
  // Which installation fits each line: linked lines exactly, older challans by product.
  const coverOf = new Map<string, { id: string; number: string }>();
  for (const c of so.installationChallans) {
    for (const l of so.items) {
      if (coverOf.has(l.id)) continue;
      const { covered } = freeOrderLines([l], [c]);
      if (covered.length) coverOf.set(l.id, { id: c.id, number: c.challanNo });
    }
  }
  return {
    orderNo: so.orderNo,
    customerName: so.party.companyName || [so.party.firstName, so.party.lastName].filter(Boolean).join(' '),
    items: so.items.map((i) => ({ ...i, coveredBy: coverOf.get(i.id) ?? null })),
    installations: so.installationChallans.map((c) => ({ id: c.id, number: c.challanNo, stage: c.stage, href: `/services/installations/${c.id}` })),
    sites: sites.map((x) => ({ id: x.id, name: x.name, address: x.address, lat: Number(x.latitude), lng: Number(x.longitude) })),
    openJob: so.installationJobs[0]
      ? { id: so.installationJobs[0].id, number: so.installationJobs[0].complaintNo, href: `/services/complaints/${so.installationJobs[0].id}` }
      : null,
    locationRequired: await locationRequired(scope),
  };
}

export async function createInstallationJob(
  scope: StoreScope, salesOrderId: string,
  input: { siteId?: string | null; location?: { lat: number; lng: number; source: 'gps' | 'maps_link' } | null; siteNote?: string | null; priority?: string; note?: string | null; lineIds?: string[] | null },
  userId: string,
): Promise<{ id: string; challanNo: string; href: string }> {
  scopeForWrite(scope);
  const setup = await installationSetup(scope, salesOrderId);
  if (setup.openJob) throw new ComplaintError(`An installation (${setup.openJob.number}) is already open for this order.`);
  const free = setup.items.filter((i) => !i.coveredBy && i.qty > 0);
  if (!free.length) throw new ComplaintError('Every line of this order is already on an installation - open it instead.');
  const wanted = input.lineIds?.length ? free.filter((i) => input.lineIds!.includes(i.id)) : free;
  if (input.lineIds?.length && wanted.length !== input.lineIds.length) {
    throw new ComplaintError('Some of those lines are already on another installation. Refresh and choose again.');
  }

  const site = input.siteId ? setup.sites.find((s) => s.id === input.siteId) : null;
  if (input.siteId && !site) throw new ComplaintError('That site has no location saved - capture the location instead.');
  const given = site ? { lat: site.lat, lng: site.lng, source: 'maps_link' as const } : input.location;
  const where = given && Number.isFinite(given.lat) && Number.isFinite(given.lng) ? given : null;
  // Switched off in Field rules: the job is raised without a pin and the
  // technician captures it on arrival, exactly as for a complaint.
  if (!where && setup.locationRequired) {
    throw new ComplaintError('Choose the customer\'s site or capture the installation location - the technician\'s on-site check needs it.');
  }
  const lines = wanted;
  if (!lines.length) throw new ComplaintError('Choose at least one line to install.');
  const priority = ['low', 'normal', 'high', 'urgent'].includes(input.priority ?? '') ? input.priority! : 'normal';

  // The order's lines become the challan's - what the technician fits.
  const { createInstallationChallan } = await import('./installation-challans');
  const id = await createInstallationChallan(scope, {
    salesOrderId, physicalChallanNo: null, technicianRemark: null, assigneeIds: [],
    note: input.note?.trim() || null,
    items: lines.map((i) => ({ productId: i.productId, productName: i.productName, barcode: null, qty: i.qty, unit: null, salesOrderItemId: i.id })),
  }, userId);
  await db.installationChallan.update({ where: { id }, data: { priority } });
  const challan = await db.installationChallan.update({
    where: { id },
    data: {
      siteLocation: [site?.name, site?.address, input.siteNote?.trim()].filter(Boolean).join(' - ') || null,
      siteLat: where?.lat ?? null, siteLng: where?.lng ?? null,
    },
    select: { challanNo: true },
  });
  return { id, challanNo: challan.challanNo, href: `/services/installations/${id}` };
}
