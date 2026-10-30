import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { businessDay } from './attendance-geo';
import { deviceStatus, type DeviceStatus } from '@/lib/device-trust';
import { istDayStart } from '@/lib/ist';
import { autoCloseStaleInScope } from './shifts';

/**
 * TEAM TODAY - one row per person in the branch: in or out, since when,
 * where the phone last reported from, and whether that phone is healthy.
 * What an owner opens at 10 am to see who is working.
 *
 * Reviewed 26 Sep 2026 after the Vcare meeting (wrong present count, times,
 * phone warnings):
 * - WHO is listed: the same people as the Monthly Grid - anyone with a paired
 *   phone or any attendance this month. It used to list every user with a
 *   role, so owners, accountants and test logins inflated "Not marked".
 * - TODAY is India's day. "Today" used to mean the last 24 hours, so
 *   yesterday evening's fake-location pings and last fixes counted today.
 * - FINISHED needs a real check-in. A day row with no session (leave, a
 *   correction) used to count as Finished.
 * - ON SHIFT includes a shift still open from last night - it is not "not
 *   marked" at 00:30 just because the date changed.
 * - Worked time while on shift runs live, as on the grid.
 */

export interface TeamRow {
  /** Kilometres on the road today (31 Oct 2026): a floor, readings accurate to 50 m only; null = not tracked. */
  distanceKm?: number | null;
  userId: string;
  name: string;
  status: 'on_shift' | 'done' | 'not_marked';
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number | null;
  /** Where today's first check-in came from: the phone app, the website Present button, etc. */
  source: string | null;
  openSessionId: string | null;
  lastSessionId: string | null;
  inWithinPolicy: boolean | null;
  lastFix: { lat: number; lng: number; at: string; mocked: boolean } | null;
  mockedToday: number;
  phone: DeviceStatus | 'none';
}

export async function teamToday(scope: StoreScope, now: Date = new Date()): Promise<TeamRow[]> {
  // Forgotten shifts closed first, so nobody reads as on shift for days.
  await autoCloseStaleInScope(scope);
  const workDate = businessDay(now);
  const dayStart = istDayStart(workDate);
  const monthFirst = `${workDate.slice(0, 7)}-01`;
  const where = scopeWhere(scope);

  const [days, monthPeople, devices, openLate, events] = await Promise.all([
    db.attendanceDay.findMany({
      where: { ...where, workDate },
      include: { sessions: { orderBy: { startedAt: 'desc' }, select: { id: true, endedAt: true, startWithinPolicy: true, startedAt: true, source: true } } },
    }),
    // Anyone with attendance this month - the grid's rule for who belongs on the board.
    db.attendanceDay.findMany({
      where: { ...where, workDate: { gte: monthFirst, lte: workDate } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.callSyncDevice.findMany({
      where: { ...where, isActive: true },
      select: { userId: true, isActive: true, lastSyncedAt: true, appRemovedAt: true, pairedAt: true },
    }),
    // A shift started before midnight and still open is still a shift.
    db.attendanceSession.findMany({
      where: { ...where, endedAt: null, startedAt: { gte: new Date(dayStart.getTime() - 16 * 3_600_000), lt: dayStart } },
      select: { id: true, userId: true, startedAt: true, source: true, startWithinPolicy: true },
    }),
    db.attendanceEvent.findMany({
      where: { ...where, recordedAt: { gte: dayStart } },
      orderBy: { recordedAt: 'desc' },
      select: { userId: true, lat: true, lng: true, recordedAt: true, mocked: true },
      take: 5000,
    }),
  ]);

  const ids = new Set<string>([...devices.map((d) => d.userId), ...monthPeople.map((d) => d.userId), ...openLate.map((s) => s.userId)]);
  const users = ids.size
    ? await db.user.findMany({ where: { id: { in: [...ids] }, isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
    : [];

  const dayBy = new Map(days.map((d) => [d.userId, d]));
  const deviceBy = new Map(devices.map((d) => [d.userId, d]));
  const openLateBy = new Map(openLate.map((s) => [s.userId, s]));
  const lastBy = new Map<string, (typeof events)[number]>();
  const mockedBy = new Map<string, number>();
  for (const e of events) {
    if (!lastBy.has(e.userId)) lastBy.set(e.userId, e);
    if (e.mocked) mockedBy.set(e.userId, (mockedBy.get(e.userId) ?? 0) + 1);
  }

  const rows = users.map((u): TeamRow => {
    const d = dayBy.get(u.id);
    const sessions = d?.sessions ?? [];
    const carried = openLateBy.get(u.id) ?? null;
    const open = sessions.find((s) => !s.endedAt) ?? carried;
    const first = sessions[sessions.length - 1] ?? carried;
    const firstIn = d?.firstInAt ?? carried?.startedAt ?? null;
    const dev = deviceBy.get(u.id);
    const last = lastBy.get(u.id);
    const status: TeamRow['status'] = open ? 'on_shift' : sessions.length > 0 ? 'done' : 'not_marked';
    const worked = status === 'on_shift' && firstIn
      ? Math.max(0, Math.round((now.getTime() - firstIn.getTime()) / 60_000))
      : status === 'done' ? d?.workedMinutes ?? null : null;
    return {
      userId: u.id,
      name: u.fullName,
      status,
      firstInAt: firstIn?.toISOString() ?? null,
      lastOutAt: status === 'done' ? d?.lastOutAt?.toISOString() ?? null : null,
      workedMinutes: worked,
      source: d?.firstInSource ?? first?.source ?? null,
      openSessionId: open?.id ?? null,
      lastSessionId: sessions[0]?.id ?? carried?.id ?? null,
      inWithinPolicy: first?.startWithinPolicy ?? null,
      lastFix: last ? { lat: Number(last.lat), lng: Number(last.lng), at: last.recordedAt.toISOString(), mocked: last.mocked } : null,
      mockedToday: mockedBy.get(u.id) ?? 0,
      phone: dev ? deviceStatus(dev, !!open, now) : 'none',
    };
  });
  const order = { on_shift: 0, done: 1, not_marked: 2 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}
