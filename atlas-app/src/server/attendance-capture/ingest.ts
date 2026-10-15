import 'server-only';
import { db } from '../db';
import { clockIn, clockOut, AttendanceGeoError, type AttendanceSource } from '../attendance-geo';
import { preparePunches, type PreparedPunch } from '@/lib/attendance-capture/normalise';
import type { DirectionMode, NormalisedPunch } from '@/lib/attendance-capture/contract';

/**
 * PUNCHES IN, ATTENDANCE OUT (F2.5).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: write attendance rows.
 *
 * `clockIn`/`clockOut` in `server/attendance-geo.ts` are already the single
 * gate the phone and the website both call. A machine is a third caller of the
 * same two functions with `source: 'biometric'`, and that is the entire reason
 * "sync the reader with the other ways of clocking in" needs no code: punch
 * the office reader at 09:02, open the phone at 09:30, and it is one
 * attendance day, marked biometric-first, because `clockIn` is idempotent.
 *
 * WHAT THIS FIXES FROM THE ORIGINAL `ingestPunches`.
 *
 *   - It stored no punch, so replaying a three-day-old batch would reopen
 *     sessions in the past. Now every punch has a row and a unique key.
 *   - It iterated in array order, so an OUT before its IN produced nonsense.
 *     Now the batch is sorted first (`preparePunches`).
 *   - It rejected any direction it did not recognise, which on a site where
 *     nobody presses IN or OUT would have dropped every punch. Now
 *     `first_last` is the default.
 *   - It ran one `findFirst` per row. A 20,000-punch backfill on
 *     `connection_limit=1` is the P2028 class of failure fixed on 29 Sep. Now
 *     the code -> user map is fetched once.
 *   - An unknown employee code was counted and thrown away. Now the punch is
 *     kept, unapplied, and appears in a queue somebody can resolve.
 */

export interface IngestResult {
  received: number;
  /** New rows written. */
  stored: number;
  /** Already had them - a replay, which is expected and harmless. */
  duplicates: number;
  /** Turned into a clock-in or clock-out. */
  applied: number;
  /** Stored but waiting for a person to map to. */
  unmapped: number;
  /** No usable code or time. */
  unusable: number;
  /** A person-day with one touch and no close. */
  openDays: number;
  errors: string[];
}

const EMPTY: IngestResult = {
  received: 0, stored: 0, duplicates: 0, applied: 0,
  unmapped: 0, unusable: 0, openDays: 0, errors: [],
};

export interface IngestDevice {
  id: string;
  storeId: string;
  directionMode: DirectionMode;
  defaultZone: { lat: number; lng: number } | null;
}

/** Chunked so a big backfill cannot hold one statement open for minutes. */
const CHUNK = 500;

export async function ingestNormalisedPunches(
  device: IngestDevice,
  raw: NormalisedPunch[],
): Promise<IngestResult> {
  const result: IngestResult = { ...EMPTY, errors: [], received: raw.length };
  if (raw.length === 0) return result;

  const prepared = preparePunches(device.id, raw, device.directionMode);
  result.unusable = prepared.unusable;
  result.duplicates = prepared.duplicates;
  result.openDays = prepared.openDays;
  if (prepared.punches.length === 0) return result;

  /**
   * One lookup for every code in the batch, not one per punch. The old
   * per-row `findFirst` is what would have made a backfill time out.
   */
  const codes = [...new Set(prepared.punches.map((p) => p.employeeCode))];
  const users = await db.user.findMany({
    where: { userCode: { in: codes }, storeRoles: { some: { storeId: device.storeId } } },
    select: { id: true, userCode: true },
  });
  const userByCode = new Map(users.map((u) => [u.userCode, u.id]));
  // A code somebody mapped by hand wins over the user-code match, and a code
  // whose mapping was undone (userId null) stays unattributed (14 Oct 2026).
  const maps = await db.attendanceCodeMap.findMany({
    where: { storeId: device.storeId, employeeCode: { in: codes } },
    select: { employeeCode: true, userId: true },
  });
  for (const m of maps) {
    if (m.userId) userByCode.set(m.employeeCode, m.userId);
    else userByCode.delete(m.employeeCode);
  }

  // Which of these we already hold. Re-reading a window is normal - the pull
  // deliberately overlaps so a late upload is not missed - so a replay must be
  // cheap and silent rather than an error.
  const existing = new Set<string>();
  for (let i = 0; i < prepared.punches.length; i += CHUNK) {
    const keys = prepared.punches.slice(i, i + CHUNK).map((p) => p.key);
    const rows = await db.attendancePunch.findMany({
      where: { deviceId: device.id, punchKey: { in: keys } },
      select: { punchKey: true },
    });
    for (const r of rows) existing.add(r.punchKey);
  }

  const fresh = prepared.punches.filter((p) => !existing.has(p.key));
  result.duplicates += prepared.punches.length - fresh.length;
  if (fresh.length === 0) return result;

  for (let i = 0; i < fresh.length; i += CHUNK) {
    const slice = fresh.slice(i, i + CHUNK);
    const written = await db.attendancePunch.createMany({
      data: slice.map((p) => ({
        storeId: device.storeId,
        deviceId: device.id,
        punchKey: p.key,
        employeeCode: p.employeeCode,
        userId: userByCode.get(p.employeeCode) ?? null,
        punchAtUtc: p.atUtc,
        direction: p.direction,
        inferred: p.inferred,
        verifyType: p.verifyType ?? null,
        terminalRef: p.terminalRef ?? null,
        externalId: p.externalId ?? null,
        raw: (p.raw ?? undefined) as object | undefined,
      })),
      // Two agents racing the same window would otherwise fail the whole
      // batch on one row.
      skipDuplicates: true,
    });
    result.stored += written.count;
  }

  await applyPunches(device, fresh, userByCode, result);
  return result;
}

/**
 * Turn stored punches into sessions, oldest first.
 *
 * Order matters and is not decorative: `clockOut` closes whatever is open, so
 * running an OUT before its IN would close yesterday's session and leave
 * today's open. `preparePunches` already sorted them; this keeps that order.
 */
async function applyPunches(
  device: IngestDevice,
  punches: PreparedPunch[],
  userByCode: Map<string, string>,
  result: IngestResult,
): Promise<void> {
  const fix = device.defaultZone
    ? { lat: device.defaultZone.lat, lng: device.defaultZone.lng, accuracyM: null }
    : null;
  const source: AttendanceSource = 'biometric';

  for (const p of punches) {
    const userId = userByCode.get(p.employeeCode);
    if (!userId) {
      // Kept, not dropped. It sits in the queue with its code showing, and
      // becomes attendance the moment somebody maps the code to a person.
      result.unmapped += 1;
      continue;
    }

    try {
      if (p.direction === 'in') {
        await clockIn({ userId, storeId: device.storeId, source }, { fix }, p.atUtc);
      } else {
        await clockOut({ userId, source }, { fix }, p.atUtc);
      }
      await db.attendancePunch.updateMany({
        where: { deviceId: device.id, punchKey: p.key },
        data: { appliedAt: new Date() },
      });
      result.applied += 1;
    } catch (e) {
      // One bad punch never fails the batch. The machine is unattended and
      // cannot fix a bad row, so refusing the batch would only make it retry
      // the same row for ever - the tolerant-batch rule the call-log sync
      // already follows.
      const why = e instanceof AttendanceGeoError ? e.message : 'Could not record that punch.';
      if (result.errors.length < 20) result.errors.push(`${p.employeeCode} ${p.atUtc.toISOString()}: ${why}`);
    }
  }
}

/** Codes seen on this device that match nobody - the mapping screen's worklist. */
export async function unmappedCodes(storeId: string, deviceId?: string): Promise<{
  employeeCode: string; punches: number; firstSeen: Date; lastSeen: Date;
}[]> {
  const rows = await db.attendancePunch.groupBy({
    by: ['employeeCode'],
    where: { storeId, userId: null, ...(deviceId ? { deviceId } : {}) },
    _count: { _all: true },
    _min: { punchAtUtc: true },
    _max: { punchAtUtc: true },
  });

  return rows
    .map((r) => ({
      employeeCode: r.employeeCode,
      punches: r._count._all,
      firstSeen: r._min.punchAtUtc ?? new Date(0),
      lastSeen: r._max.punchAtUtc ?? new Date(0),
    }))
    .sort((a, b) => b.punches - a.punches);
}

/**
 * Attach a code to a person and replay what was waiting.
 *
 * The replay is the point: somebody mapped late should not lose the week their
 * punches were sitting unclaimed.
 */
export async function mapCodeToUser(
  device: IngestDevice, employeeCode: string, userId: string,
): Promise<IngestResult> {
  await db.attendancePunch.updateMany({
    where: { storeId: device.storeId, employeeCode, userId: null },
    data: { userId },
  });

  const waiting = await db.attendancePunch.findMany({
    where: { storeId: device.storeId, employeeCode, userId, appliedAt: null },
    orderBy: { punchAtUtc: 'asc' },
    select: { punchKey: true, employeeCode: true, punchAtUtc: true, direction: true, inferred: true },
  });

  const result: IngestResult = { ...EMPTY, errors: [], received: waiting.length };
  await applyPunches(
    device,
    waiting.map((w) => ({
      employeeCode: w.employeeCode,
      atUtc: w.punchAtUtc,
      direction: w.direction as 'in' | 'out',
      key: w.punchKey,
      inferred: w.inferred,
    })),
    new Map([[employeeCode, userId]]),
    result,
  );
  return result;
}
