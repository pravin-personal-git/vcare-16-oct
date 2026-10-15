import 'server-only';
import { db } from './db';
import { businessDay, clockIn, clockOut, getTodayStatus, AttendanceGeoError } from './attendance-geo';

/**
 * THE PRESENT BUTTON.
 *
 * Attendance for people who never carry the field handset - managers, office
 * staff, anyone who works at a desk in front of Atlas all day.
 *
 * REWRITTEN 18 SEP 2026 TO SHARE THE UNIFIED ATTENDANCE GATE.
 *
 * Until this date this wrote its own table, `WebPresence`, kept deliberately
 * separate from `Shift` - a press of this button carries whatever the browser
 * felt like reporting, not GPS from a company-issued handset, and the two
 * were never allowed to look like the same evidence.
 *
 * That distinction did not go away - it is the `source` column on
 * `AttendanceSession` now (`'web'` here, `'app'` for the phone), a fact on
 * the row instead of an inference from which table it landed in. What
 * changed is that both are now the SAME gate: press this after clocking in
 * from the app, and `clockIn` below returns the session that is already
 * open rather than starting a second one - which is the whole reason this
 * rewrite happened. `WebPresence` itself is untouched, kept only as a
 * historical record of presses made before this date.
 */

// ------------------------------------------------------------------- reading

export interface PresenceState {
  /** The AttendanceDay id - used as the audit-log entity id. */
  id: string;
  workDate: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Null until clocked out. Minutes. */
  workedMinutes: number | null;
  hasLocation: boolean;
  inAccuracyM: number | null;
  source: 'app' | 'web' | 'biometric' | 'manual' | null;
}

export { businessDay };

export async function todaysPresence(userId: string, now: Date = new Date()): Promise<PresenceState | null> {
  const status = await getTodayStatus(userId, now);
  if (status.status === 'not_marked' || !status.firstInAt) return null;

  const day = await db.attendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate: status.workDate } },
    select: {
      id: true,
      sessions: { orderBy: { startedAt: 'asc' }, take: 1, select: { startLat: true, startAccuracyM: true } },
    },
  });
  if (!day) return null;
  const firstSession = day.sessions[0];

  return {
    id: day.id,
    workDate: status.workDate,
    clockInAt: status.firstInAt,
    clockOutAt: status.status === 'completed' ? status.lastOutAt : null,
    workedMinutes: status.status === 'completed' ? status.workedMinutes : null,
    hasLocation: firstSession?.startLat != null,
    inAccuracyM: firstSession?.startAccuracyM ?? null,
    source: status.firstInSource,
  };
}

// ------------------------------------------------------------------- writing

/** What the browser managed to find out about where it is. All optional. */
export interface BrowserFix {
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
}

export interface PresenceResult {
  state: PresenceState;
  /** Something the person should be told, beyond the state itself. */
  warning: string | null;
}

/**
 * A fix the browser reported, reduced to what `clockIn`/`clockOut` will take.
 *
 * A coordinate outside the possible range means the caller sent nonsense, and
 * storing it would put a bad number in a wage record; a fix accurate to more
 * than ten kilometres says nothing about where anyone was. Both are dropped
 * rather than rejected, because neither is a reason to refuse the attendance.
 */
function cleanFix(fix: BrowserFix | undefined): { lat: number; lng: number; accuracyM: number | null } | null {
  const lat = typeof fix?.lat === 'number' && Math.abs(fix.lat) <= 90 ? fix.lat : null;
  const lng = typeof fix?.lng === 'number' && Math.abs(fix.lng) <= 180 ? fix.lng : null;
  const acc =
    typeof fix?.accuracyM === 'number' && fix.accuracyM > 0 && fix.accuracyM <= 10_000
      ? Math.round(fix.accuracyM)
      : null;
  if (lat === null || lng === null) return null;
  return { lat, lng, accuracyM: acc };
}

export async function markPresent(
  input: { userId: string; storeId: string; fix?: BrowserFix; ipAddress?: string | null },
  now: Date = new Date(),
): Promise<PresenceResult> {
  const existing = await getTodayStatus(input.userId, now);
  if (existing.status !== 'not_marked') {
    throw new Error(
      existing.status === 'completed'
        ? 'You have already finished for today.'
        : 'You are already marked present for today.',
    );
  }

  const fix = cleanFix(input.fix);

  let result;
  try {
    result = await clockIn(
      { userId: input.userId, storeId: input.storeId, source: 'web' },
      { fix, ipAddress: input.ipAddress ?? null },
      now,
    );
  } catch (err) {
    if (err instanceof AttendanceGeoError) throw new Error(err.message);
    throw err;
  }

  const state = await todaysPresence(input.userId, now);

  // `alreadyOpen` only fires on a genuine race - the guard above already
  // catches the ordinary "you already pressed this" case before clockIn is
  // even called. Treated as a harmless idempotent success, same as a
  // retried phone request finding its own shift already open.
  const warning = result.alreadyOpen
    ? 'Already marked present for today.'
    : (fix === null ? 'Recorded without a location.' : null);

  return { state: state!, warning };
}

export async function markLeaving(
  input: { userId: string; fix?: BrowserFix },
  now: Date = new Date(),
): Promise<PresenceResult> {
  const existing = await getTodayStatus(input.userId, now);
  if (existing.status === 'not_marked') throw new Error('You have not marked yourself present today.');
  if (existing.status === 'completed') throw new Error('You have already finished for today.');

  const fix = cleanFix(input.fix);

  try {
    await clockOut(
      { userId: input.userId, source: 'web' },
      { fix },
      now,
    );
  } catch (err) {
    if (err instanceof AttendanceGeoError) throw new Error(err.message);
    throw err;
  }

  const state = await todaysPresence(input.userId, now);

  return { state: state!, warning: null };
}

