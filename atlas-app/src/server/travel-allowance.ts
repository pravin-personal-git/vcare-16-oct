import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { raiseApproval } from './hierarchy';
import { businessDay } from './attendance-geo';
import { DEFAULT_DISTANCE_RULE, distanceOf, type TrackPoint } from '@/lib/distance';
import { metresBetween } from '@/lib/shift';
import {
  claimTag, parseTravelSettings, travelLine, type TravelLine, type TravelSettingsValue, type Vehicle,
} from '@/lib/travel-allowance';

/** `5850 Vehicle & Fuel` - where the daily petrol cash is recorded. */
const FUEL_ACCOUNT = '5850';
/** The flat travel component in `COMPONENT_PRESETS` (server/salary-contracts). */
const CONVEYANCE_CODE = 'CONVEYANCE';

/** Travel allowance (F-03, 6 Oct 2026) - see lib/travel-allowance. */
export class TravelError extends Error {}

export async function getTravelSettings(storeId: string): Promise<TravelSettingsValue> {
  const row = await db.travelSettings.findUnique({ where: { storeId }, select: { settings: true } });
  return parseTravelSettings(row?.settings);
}

export async function saveTravelSettings(storeId: string, value: unknown, userId: string): Promise<TravelSettingsValue> {
  const clean = parseTravelSettings(value);
  await db.travelSettings.upsert({
    where: { storeId },
    create: { storeId, settings: clean as unknown as object, updatedBy: userId },
    update: { settings: clean as unknown as object, updatedBy: userId, version: { increment: 1 } },
  });
  return clean;
}

const monthBounds = (month: string) => {
  const from = new Date(`${month}-01T00:00:00+05:30`);
  const [y, m] = month.split('-').map(Number);
  const to = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+05:30`);
  return { from, to };
};

/** Metres per business day, per person, from the location trail. */
async function trailMetres(scope: StoreScope, userIds: string[], from: Date, to: Date) {
  const rows = await db.attendanceEvent.findMany({
    where: { ...scopeWhere(scope), userId: { in: userIds }, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: 'asc' },
    select: { userId: true, lat: true, lng: true, accuracyM: true, mocked: true, recordedAt: true },
  });
  const byDay = new Map<string, TrackPoint[]>();
  for (const r of rows) {
    const key = `${r.userId}|${businessDay(r.recordedAt)}`;
    const list = byDay.get(key) ?? [];
    list.push({ lat: Number(r.lat), lng: Number(r.lng), accuracyM: r.accuracyM, mocked: r.mocked, at: r.recordedAt.getTime() });
    byDay.set(key, list);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [key, pts] of byDay) {
    const [uid, day] = key.split('|') as [string, string];
    const m = out.get(uid) ?? new Map<string, number>();
    m.set(day, distanceOf(pts, DEFAULT_DISTANCE_RULE).metres);
    out.set(uid, m);
  }
  return out;
}

/** Metres per business day: straight lines between the job sites reached, in order. */
async function visitMetres(scope: StoreScope, userIds: string[], from: Date, to: Date) {
  const arrivals = await db.complaintActivity.findMany({
    where: {
      statusTo: 'on_site', createdBy: { in: userIds }, createdAt: { gte: from, lt: to },
      complaint: { ...scopeWhere(scope), siteLat: { not: null }, siteLng: { not: null } },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdBy: true, createdAt: true, complaint: { select: { siteLat: true, siteLng: true } } },
  });
  const byDay = new Map<string, { lat: number; lng: number }[]>();
  for (const a of arrivals) {
    const key = `${a.createdBy}|${businessDay(a.createdAt)}`;
    const list = byDay.get(key) ?? [];
    list.push({ lat: Number(a.complaint.siteLat), lng: Number(a.complaint.siteLng) });
    byDay.set(key, list);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [key, sites] of byDay) {
    const [uid, day] = key.split('|') as [string, string];
    let metres = 0;
    for (let i = 1; i < sites.length; i++) metres += metresBetween(sites[i - 1]!, sites[i]!);
    const m = out.get(uid) ?? new Map<string, number>();
    m.set(day, metres);
    out.set(uid, m);
  }
  return out;
}

// ------------------------------------------------- fuel given vs distance
//
// VCARE'S ACTUAL SITUATION (8 Oct 2026), and why this is separate from the
// allowance above.
//
// Vcare owns the bikes and hands its technicians petrol money EVERY DAY. So
// there is no claim to raise and no allowance to pay - the company has
// already paid for the fuel. What they need instead is the other half of the
// control: per person, how much fuel cash went out, how far that person
// actually rode, and whether the two agree. A bike used on a Sunday for
// somebody's own errand shows up here as cash with no distance behind it.
//
// This deliberately works whether or not the allowance is switched on, and
// for anybody who received fuel cash - not only the people listed in the
// travel settings. A business on the daily-cash model (Model B) never turns
// the allowance on at all, and this screen still has to answer the question.
//
// The rate is used only to say what the distance WOULD have cost. Nothing
// here pays anybody, raises a claim, or touches a payslip.

/** Asset types that count as a vehicle. `Asset.assetType` is free text, so this matches loosely. */
const VEHICLE_WORDS = ['vehicle', 'bike', 'scooter', 'scooty', 'motorcycle', 'motorbike', 'car', 'two wheeler', 'two-wheeler'];

export interface FuelRow {
  userId: string;
  name: string;
  /**
   * A fixed `CONVEYANCE` component on their live salary contract, if there is
   * one (8 Oct 2026, G-18). Set here only to be WARNED about: a person paid a
   * flat conveyance allowance every month AND handed fuel cash (or paid a
   * km-based allowance) is being paid for the same petrol twice, and nothing
   * used to say so. Atlas does not pick one - it names the clash and leaves
   * the choice to whoever set the two up.
   */
  conveyancePaise: number | null;
  /** The company vehicle assigned to them, if Assets knows of one. */
  vehicle: string | null;
  /** From the travel settings, for the rate. Defaults to bike. */
  vehicleKind: Vehicle;
  km: number;
  ratePaise: number;
  /** What that distance would cost at the rate - NOT money owed to anybody. */
  expectedPaise: number;
  /** Fuel cash actually handed to them this month: approved 5850 expense vouchers. */
  givenPaise: number;
  voucherCount: number;
  /** given − expected. Positive = more cash than the riding explains. */
  variancePaise: number;
  /** What the cash works out to per km ridden. Null when they rode nothing. */
  perKmPaise: number | null;
}

export async function fuelMonth(scope: StoreScope, storeId: string, month: string): Promise<{
  settings: TravelSettingsValue; rows: FuelRow[]; givenTotalPaise: number; expectedTotalPaise: number;
}> {
  const settings = await getTravelSettings(storeId);
  const { from, to } = monthBounds(month);

  // Fuel cash out this month - the one source for "what did we actually pay".
  const vouchers = await db.transaction.findMany({
    where: {
      ...scopeWhere(scope), txnType: 'expense', status: 'approved',
      categoryAccountCode: FUEL_ACCOUNT, txnDate: { gte: from, lt: to },
    },
    select: { paidToUserId: true, amountPaise: true },
  });

  const given = new Map<string, { paise: number; count: number }>();
  let unattributedPaise = 0;
  for (const v of vouchers) {
    if (!v.paidToUserId) { unattributedPaise += v.amountPaise; continue; }
    const row = given.get(v.paidToUserId) ?? { paise: 0, count: 0 };
    row.paise += v.amountPaise;
    row.count += 1;
    given.set(v.paidToUserId, row);
  }

  const assets = await db.asset.findMany({
    where: {
      ...scopeWhere(scope), isActive: true, assignedToId: { not: null },
      OR: VEHICLE_WORDS.map((w) => ({ assetType: { contains: w, mode: 'insensitive' as const } })),
    },
    select: { name: true, serialNumber: true, assignedToId: true },
  });
  const vehicleByUser = new Map(assets
    .filter((a) => a.assignedToId)
    .map((a) => [a.assignedToId!, [a.name, a.serialNumber].filter(Boolean).join(' · ')]));

  // Everyone the question is about: given fuel cash, OR holding a company
  // vehicle, OR listed in the travel settings.
  const userIds = [...new Set([...given.keys(), ...vehicleByUser.keys(), ...Object.keys(settings.vehicles)])];
  if (userIds.length === 0) {
    return { settings, rows: [], givenTotalPaise: unattributedPaise, expectedTotalPaise: 0 };
  }

  const [metres, users, conveyance] = await Promise.all([
    settings.source === 'visits' ? visitMetres(scope, userIds, from, to) : trailMetres(scope, userIds, from, to),
    db.user.findMany({ where: { ...userInScope(scope), id: { in: userIds } }, select: { id: true, fullName: true } }),
    conveyanceByUser(scope, userIds),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  const rows = userIds.filter((id) => name.has(id)).map((id) => {
    const kind = settings.vehicles[id] ?? 'bike';
    // Same daily cap as the allowance, so the two screens cannot report
    // different distances for the same month.
    const line = travelLine(id, kind, metres.get(id) ?? new Map(), settings);
    const givenPaise = given.get(id)?.paise ?? 0;
    return {
      userId: id, name: name.get(id)!, vehicle: vehicleByUser.get(id) ?? null, vehicleKind: kind,
      conveyancePaise: conveyance.get(id) ?? null,
      km: line.paidKm, ratePaise: line.ratePaise, expectedPaise: line.amountPaise,
      givenPaise, voucherCount: given.get(id)?.count ?? 0,
      variancePaise: givenPaise - line.amountPaise,
      perKmPaise: line.paidKm > 0 ? Math.round(givenPaise / line.paidKm) : null,
    };
  }).sort((a, b) => b.variancePaise - a.variancePaise || a.name.localeCompare(b.name));

  return {
    settings, rows,
    givenTotalPaise: rows.reduce((n, r) => n + r.givenPaise, 0) + unattributedPaise,
    expectedTotalPaise: rows.reduce((n, r) => n + r.expectedPaise, 0),
  };
}

/**
 * A flat `CONVEYANCE` allowance on each person's live contract (G-18).
 *
 * Only `fixed` components are read: a percentage or per-day conveyance has no
 * single monthly figure to show, and a clash is worth naming either way, so
 * one of those comes back as 0 rather than being missed.
 */
async function conveyanceByUser(scope: StoreScope, userIds: string[]): Promise<Map<string, number>> {
  const contracts = await db.salaryContract.findMany({
    where: {
      ...scopeWhere(scope), userId: { in: userIds }, isActive: true, effectiveTo: null,
      components: { some: { code: CONVEYANCE_CODE } },
    },
    select: {
      userId: true,
      components: { where: { code: CONVEYANCE_CODE }, select: { monthlyPaise: true } },
    },
  });
  return new Map(contracts.map((c) => [
    c.userId,
    c.components.reduce((n, x) => n + (x.monthlyPaise ?? 0), 0),
  ]));
}

/** Fuel cash recorded with nobody named - it counts in the total but explains nothing. */
export async function unattributedFuelPaise(scope: StoreScope, month: string): Promise<number> {
  const { from, to } = monthBounds(month);
  const rows = await db.transaction.findMany({
    where: {
      ...scopeWhere(scope), txnType: 'expense', status: 'approved',
      categoryAccountCode: FUEL_ACCOUNT, txnDate: { gte: from, lt: to }, paidToUserId: null,
    },
    select: { amountPaise: true },
  });
  return rows.reduce((n, r) => n + r.amountPaise, 0);
}

export interface TravelMonthRow extends TravelLine {
  name: string;
  /** Already claimed for this month: the claim's status. */
  claimStatus: string | null;
}

export async function travelMonth(scope: StoreScope, storeId: string, month: string): Promise<{
  settings: TravelSettingsValue; rows: TravelMonthRow[];
}> {
  const settings = await getTravelSettings(storeId);
  const userIds = Object.keys(settings.vehicles);
  if (!userIds.length) return { settings, rows: [] };

  const { from, to } = monthBounds(month);
  const [metres, users, claims] = await Promise.all([
    settings.source === 'visits' ? visitMetres(scope, userIds, from, to) : trailMetres(scope, userIds, from, to),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    db.reimbursementClaim.findMany({
      where: { ...scopeWhere(scope), userId: { in: userIds }, category: 'travel', deletedAt: null, description: { startsWith: claimTag(month) } },
      select: { userId: true, status: true },
    }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const claimed = new Map(claims.filter((c) => c.status !== 'rejected').map((c) => [c.userId, c.status]));

  const rows = userIds
    .filter((id) => name.has(id))
    .map((id) => ({
      ...travelLine(id, settings.vehicles[id]!, metres.get(id) ?? new Map(), settings),
      name: name.get(id)!, claimStatus: claimed.get(id) ?? null,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise || a.name.localeCompare(b.name));
  return { settings, rows };
}

/**
 * Turn a month into travel claims, one per person, through the normal
 * reimbursement approval (Payroll › Claims pays them). A person already
 * claimed for the month is skipped, so pressing it twice is harmless.
 */
export async function raiseTravelClaims(
  scope: StoreScope, month: string, userIds: string[], by: string,
): Promise<number> {
  const storeId = scopeForWrite(scope);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new TravelError('Pick a month.');
  const { settings, rows } = await travelMonth(scope, storeId, month);
  if (!settings.enabled) throw new TravelError('Switch the travel allowance on first.');
  const { to } = monthBounds(month);
  const lastDay = new Date(to.getTime() - 86_400_000);

  let made = 0;
  for (const r of rows) {
    if (!userIds.includes(r.userId) || r.claimStatus || r.amountPaise <= 0) continue;
    const claim = await db.reimbursementClaim.create({
      data: {
        storeId, userId: r.userId, category: 'travel', amountPaise: r.amountPaise, expenseDate: lastDay,
        description: `${claimTag(month)} · ${r.paidKm} km × ₹${(r.ratePaise / 100).toFixed(2)} (${r.vehicle}, ${settings.source === 'visits' ? 'between job sites' : 'location trail'})`
          + (r.cappedDaily ? ` · daily cap ${settings.dailyCapKm} km` : '') + (r.cappedMonthly ? ' · monthly cap' : ''),
        requestedBy: by,
      },
    });
    // Routed as the person's own claim, so it goes to their manager.
    await raiseApproval(scope, 'reimbursement', claim.id, r.userId);
    made += 1;
  }
  return made;
}
