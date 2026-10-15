import { BUSINESS_TZ } from '../shift';
import { punchKey, type DirectionMode, type NormalisedPunch, type PunchDirection } from './contract';

/**
 * Turning a pile of raw punches into a day somebody can be paid for (F2.5).
 *
 * Pure, and separate from every adapter, because these three decisions are the
 * same whatever brand the reader is - and each one is a way to get somebody's
 * hours wrong:
 *
 *   1. ORDER. Punches do not arrive sorted. A reader that was offline uploads
 *      a backlog, and a batch where an OUT precedes its IN produces nonsense.
 *   2. DIRECTION. Most sites never press IN or OUT (see `DirectionMode`).
 *   3. DUPLICATES. A batch that times out gets re-sent. Replaying it must add
 *      nothing.
 */

/** A naive local time from a vendor - "2026-03-04 09:50:00" - to UTC. */
export function parseVendorTime(text: string, offsetMinutes = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) {
    const loose = new Date(text);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, y, mo, d, h, mi, s] = m;

  /**
   * The vendor's clock is wall-clock in the business's own timezone, with no
   * offset attached - the ZKTeco manual's `punch_time` is exactly this. So the
   * business timezone is applied here rather than the server's, which is UTC
   * in production and would shift every punch by five and a half hours. That
   * bug was live across ninety date formats on 27 Sep; this is the same trap.
   */
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  const tzOffsetMs = businessOffsetMs(new Date(asUtc));
  return new Date(asUtc - tzOffsetMs - offsetMinutes * 60_000);
}

/** The business timezone's offset from UTC at that instant, in ms. */
function businessOffsetMs(at: Date): number {
  const asIfUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asIfLocal = new Date(at.toLocaleString('en-US', { timeZone: BUSINESS_TZ }));
  return asIfLocal.getTime() - asIfUtc.getTime();
}

/**
 * Map a vendor's in/out flag.
 *
 * Unknown returns null rather than guessing `in`. Null is a real answer here -
 * it hands the decision to `first_last`, which is usually more reliable than
 * the flag anyway.
 */
export function directionFromState(
  state: unknown,
  map: { in: string[]; out: string[] } = { in: ['0', 'i', 'in', 'checkin', 'check-in'], out: ['1', 'o', 'out', 'checkout', 'check-out'] },
): PunchDirection | null {
  if (state === null || state === undefined) return null;
  const s = String(state).trim().toLowerCase();
  if (map.in.includes(s)) return 'in';
  if (map.out.includes(s)) return 'out';
  return null;
}

/** The business day a punch belongs to, as `yyyy-mm-dd` in business time. */
export function businessDayOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

export interface PreparedPunch extends NormalisedPunch {
  direction: PunchDirection;
  key: string;
  /** True when `first_last` decided this, not the vendor. */
  inferred: boolean;
}

export interface PrepareResult {
  punches: PreparedPunch[];
  /** Dropped as an exact repeat within this batch. */
  duplicates: number;
  /** Dropped for having no usable code or time. */
  unusable: number;
  /** A person-day where the mode left only one punch, so nothing closed. */
  openDays: number;
}

/**
 * Sort, de-duplicate, and settle direction for one batch.
 *
 * `first_last` is applied per person per BUSINESS DAY, not per batch: a batch
 * may hold three days of backlog, and the last punch of the batch is not the
 * last punch of Tuesday.
 */
export function preparePunches(
  deviceId: string,
  raw: NormalisedPunch[],
  mode: DirectionMode,
): PrepareResult {
  const out: PrepareResult = { punches: [], duplicates: 0, unusable: 0, openDays: 0 };

  const usable = raw.filter((p) => {
    const ok = p.employeeCode.trim() !== ''
      && p.atUtc instanceof Date && !Number.isNaN(p.atUtc.getTime());
    if (!ok) out.unusable += 1;
    return ok;
  });

  // Sorted here rather than trusting the adapter: a backlog arrives in
  // whatever order the vendor felt like, and an OUT before its IN is nonsense.
  usable.sort((a, b) => a.atUtc.getTime() - b.atUtc.getTime());

  const seen = new Set<string>();
  const deduped: NormalisedPunch[] = [];
  for (const p of usable) {
    const k = punchKey(deviceId, p);
    if (seen.has(k)) { out.duplicates += 1; continue; }
    seen.add(k);
    deduped.push(p);
  }

  if (mode === 'from_state') {
    for (const p of deduped) {
      // A punch the vendor could not label is left to the caller's queue
      // rather than guessed at.
      if (p.direction === null) { out.unusable += 1; continue; }
      out.punches.push({ ...p, direction: p.direction, key: punchKey(deviceId, p), inferred: false });
    }
    return out;
  }

  // first_last, per person per business day.
  const byPersonDay = new Map<string, NormalisedPunch[]>();
  for (const p of deduped) {
    const k = `${p.employeeCode}|${businessDayOf(p.atUtc)}`;
    byPersonDay.set(k, [...(byPersonDay.get(k) ?? []), p]);
  }

  for (const group of byPersonDay.values()) {
    if (group.length === 1) {
      // One touch all day: an arrival with no departure. Recorded as an
      // arrival and counted, because the alternative - inventing a departure -
      // would put hours on a timesheet that nobody worked.
      out.openDays += 1;
      out.punches.push({ ...group[0], direction: 'in', key: punchKey(deviceId, group[0]), inferred: true });
      continue;
    }
    const first = group[0];
    const last = group[group.length - 1];
    out.punches.push({ ...first, direction: 'in', key: punchKey(deviceId, first), inferred: true });
    out.punches.push({ ...last, direction: 'out', key: punchKey(deviceId, last), inferred: true });
    // Punches between the two are real but say nothing about the working day -
    // somebody stepping out for tea and back. Kept out of the session, not
    // deleted: the raw rows are still stored.
  }

  out.punches.sort((a, b) => a.atUtc.getTime() - b.atUtc.getTime());
  return out;
}

/**
 * Clock skew between the reader and us, in seconds.
 *
 * Reported, never used to rewrite a punch. A document's time has to agree with
 * whatever the person saw on the machine; silently correcting it would make
 * the attendance record disagree with their own memory of the morning.
 */
export function clockSkewSeconds(vendorNow: Date, ourNow: Date = new Date()): number {
  return Math.round((vendorNow.getTime() - ourNow.getTime()) / 1000);
}

export const SKEW_WARNING_SECONDS = 5 * 60;
