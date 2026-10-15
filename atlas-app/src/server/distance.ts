import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { resolveForUser } from './app-access';
import { businessDay } from './attendance-geo';
import {
  DEFAULT_DISTANCE_RULE, EMPTY_DISTANCE, distanceOf, sumDistances,
  type DistanceResult, type TrackPoint,
} from '@/lib/distance';

/**
 * How far people travelled (F1c, PAPER-TRAIL-AND-DISTANCE-SPEC §B).
 *
 * The maths is in `lib/distance.ts` and is pure; this only fetches the
 * breadcrumbs and groups them. `AttendanceEvent` has held the trail since
 * 18 Sep - lat, lng, accuracy, mocked, recordedAt - and nothing ever summed it.
 *
 * DISTANCE IS COMPUTED, NEVER STORED.
 *
 * Same rule F3 sets for stock balances and customer outstanding: derived
 * figures are recomputed from the ledger rather than written down. A stored
 * kilometre total would go stale the moment a late offline batch arrived, and
 * a stale distance is not obviously wrong the way a stale stock count is.
 *
 * NULL IS NOT ZERO, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * A person whose location tracking is switched off has no distance - not a
 * distance of nought. Reporting "0 km" for them says they sat still all day,
 * which is a claim about a person, and a wrong one. Every function here
 * returns null for "not tracked" and the screens print "Not tracked".
 */

export interface UserDistance {
  userId: string;
  /** Null when this person's location tracking is off - not zero. */
  result: DistanceResult | null;
}

/** Points for one person over a window, oldest first. */
async function pointsFor(
  scope: StoreScope, userId: string, from: Date, to: Date,
): Promise<TrackPoint[]> {
  const rows = await db.attendanceEvent.findMany({
    where: { ...scopeWhere(scope), userId, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: 'asc' },
    select: { lat: true, lng: true, accuracyM: true, mocked: true, recordedAt: true },
  });

  return rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    accuracyM: r.accuracyM,
    mocked: r.mocked,
    at: r.recordedAt.getTime(),
  }));
}

/**
 * Whether this person is tracked at all.
 *
 * Read per person rather than assumed from the store, because `tracking.location`
 * is a per-role and per-person switch (`lib/app-access.ts`) - one branch can
 * track its technicians and not its office staff.
 */
async function isTracked(userId: string, storeIds: string[]): Promise<boolean> {
  try {
    return (await resolveForUser(userId, storeIds)).tracking.location;
  } catch {
    // A person with no role in scope cannot be tracked; treat that as off
    // rather than failing the whole screen.
    return false;
  }
}

/** One person, one day. */
export async function distanceForDay(
  scope: StoreScope, userId: string, storeIds: string[], day: Date,
): Promise<DistanceResult | null> {
  if (!(await isTracked(userId, storeIds))) return null;
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 86_400_000);
  return distanceOf(await pointsFor(scope, userId, from, to), DEFAULT_DISTANCE_RULE);
}

/**
 * One person, one shift.
 *
 * Scoped by the session's own start and end rather than by the day, so a
 * night shift that crosses midnight is one figure rather than two halves. An
 * open shift is measured up to now.
 */
export async function distanceForSession(
  scope: StoreScope, sessionId: string,
): Promise<DistanceResult | null> {
  const session = await db.attendanceSession.findFirst({
    where: { id: sessionId, ...scopeWhere(scope) },
    select: { userId: true, storeId: true, startedAt: true, endedAt: true },
  });
  if (!session) return null;
  if (!(await isTracked(session.userId, [session.storeId]))) return null;

  const rows = await db.attendanceEvent.findMany({
    where: { sessionId, ...scopeWhere(scope) },
    orderBy: { recordedAt: 'asc' },
    select: { lat: true, lng: true, accuracyM: true, mocked: true, recordedAt: true },
  });

  return distanceOf(rows.map((r) => ({
    lat: Number(r.lat), lng: Number(r.lng), accuracyM: r.accuracyM,
    mocked: r.mocked, at: r.recordedAt.getTime(),
  })), DEFAULT_DISTANCE_RULE);
}

/**
 * Everyone in scope over a window - the month view.
 *
 * One query for all the points rather than one per person: a branch of forty
 * over a month is forty round trips otherwise, and this screen already loads
 * the attendance grid beside it.
 */
export async function distanceForUsers(
  scope: StoreScope, userIds: string[], storeIds: string[], from: Date, to: Date,
): Promise<Map<string, DistanceResult | null>> {
  const out = new Map<string, DistanceResult | null>();
  if (userIds.length === 0) return out;

  const tracked = new Set<string>();
  await Promise.all(userIds.map(async (id) => {
    if (await isTracked(id, storeIds)) tracked.add(id);
  }));

  for (const id of userIds) out.set(id, tracked.has(id) ? { ...EMPTY_DISTANCE } : null);
  if (tracked.size === 0) return out;

  const rows = await db.attendanceEvent.findMany({
    where: { ...scopeWhere(scope), userId: { in: [...tracked] }, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: 'asc' },
    select: { userId: true, lat: true, lng: true, accuracyM: true, mocked: true, recordedAt: true },
  });

  // Grouped by person AND business day: a straight line from the end of one
  // day to the start of the next is not a journey anybody made, and joining
  // them would add a phantom commute to every month total.
  const byUserDay = new Map<string, TrackPoint[]>();
  for (const r of rows) {
    const key = `${r.userId}|${businessDay(r.recordedAt)}`;
    const p: TrackPoint = {
      lat: Number(r.lat), lng: Number(r.lng), accuracyM: r.accuracyM,
      mocked: r.mocked, at: r.recordedAt.getTime(),
    };
    byUserDay.set(key, [...(byUserDay.get(key) ?? []), p]);
  }

  const perUser = new Map<string, DistanceResult[]>();
  for (const [key, points] of byUserDay) {
    const userId = key.split('|')[0];
    perUser.set(userId, [...(perUser.get(userId) ?? []), distanceOf(points, DEFAULT_DISTANCE_RULE)]);
  }

  for (const [userId, parts] of perUser) out.set(userId, sumDistances(parts));
  return out;
}
