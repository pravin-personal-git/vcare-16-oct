import 'server-only';
import { db } from '../db';
import { scopeWhere, scopeForWrite, type StoreScope } from '../store-scope';
import { AttendanceDeviceError } from '../attendance-devices';
import { ingestNormalisedPunches, unmappedCodes, type IngestResult } from './ingest';
import { startOfDay } from '@/lib/expiry';
import {
  cleanAgentSettings, type AgentSettings, type AgentStatusReport, type AgentTestResult,
} from '@/lib/attendance-capture/agent-protocol';
import { AGENT_RELEASE } from '@/lib/attendance-capture/agent-release';

/**
 * WHOSE CODE IS THAT? (F2.5, ATTENDANCE-CAPTURE-SPEC.md §3.2)
 *
 * The machine sends a number, not a name. If the number does not match
 * anybody in Atlas the punch has nowhere to go - and the old code counted it
 * as "rejected" and threw it away, so the first anyone knew was at payroll,
 * with a week of attendance simply missing.
 *
 * Now the punch is stored unmapped and shows up here. This screen is the whole
 * safety net: it turns a silent data loss into a short list of numbers
 * somebody can put names against, and mapping a code replays everything that
 * was waiting on it.
 *
 * WORKS WITHOUT ANY VENDOR CREDENTIALS. The list is built from punches we have
 * already received, not by asking the vendor for its staff list - so it works
 * for a CSV drop and a push device exactly as it does for BioTime, and it
 * keeps working on the day the vendor rotates a password.
 */

export interface UnmappedCode {
  employeeCode: string;
  punches: number;
  firstSeen: Date;
  lastSeen: Date;
  /** People whose code or name looks close, best first. */
  suggestions: { userId: string; fullName: string; userCode: string; why: string }[];
}

export interface MappableUser {
  id: string;
  fullName: string;
  userCode: string;
  /** Already the target of some other code - shown so nobody double-books. */
  claimed: boolean;
}

/**
 * Suggestions, deliberately conservative.
 *
 * An exact code match is offered, and a close numeric one ("1001" vs "01001"),
 * because leading zeros are the single most common mismatch between a
 * biometric list and a staff list. Nothing is auto-applied: attributing one
 * person's attendance to another is worse than leaving it unmapped, and only a
 * human knows which Kumar this is.
 */
function suggest(code: string, users: MappableUser[]): UnmappedCode['suggestions'] {
  const bare = code.replace(/^0+/, '');
  const out: UnmappedCode['suggestions'] = [];

  for (const u of users) {
    if (u.claimed) continue;
    const uBare = u.userCode.replace(/^0+/, '');
    if (u.userCode === code) out.push({ userId: u.id, fullName: u.fullName, userCode: u.userCode, why: 'Same code' });
    else if (uBare === bare && bare !== '') out.push({ userId: u.id, fullName: u.fullName, userCode: u.userCode, why: 'Same number, different leading zeros' });
  }

  return out.slice(0, 3);
}

export async function mappingQueue(scope: StoreScope, deviceId?: string): Promise<{
  codes: UnmappedCode[];
  users: MappableUser[];
  mappedCount: number;
}> {
  const storeId = scopeForWrite(scope);

  const [raw, users, mapped] = await Promise.all([
    unmappedCodes(storeId, deviceId),
    db.user.findMany({
      where: { storeRoles: { some: { storeId } }, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, userCode: true },
    }),
    db.attendancePunch.groupBy({
      by: ['employeeCode'],
      where: { storeId, userId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const claimedIds = new Set(
    (await db.attendancePunch.findMany({
      where: { storeId, userId: { not: null } },
      distinct: ['userId'],
      select: { userId: true },
    })).map((r) => r.userId!),
  );

  const mappable: MappableUser[] = users.map((u) => ({
    id: u.id, fullName: u.fullName, userCode: u.userCode, claimed: claimedIds.has(u.id),
  }));

  return {
    codes: raw.map((r) => ({ ...r, suggestions: suggest(r.employeeCode, mappable) })),
    users: mappable,
    mappedCount: mapped.length,
  };
}

/**
 * Attach a code to a person, and replay what was waiting.
 *
 * The replay is the point. Somebody mapped a week late should not lose that
 * week - the punches were always stored, only unattributed.
 */
export async function mapCode(
  scope: StoreScope, employeeCode: string, userId: string, mappedBy: string | null = null,
): Promise<IngestResult> {
  const storeId = scopeForWrite(scope);

  const user = await db.user.findFirst({
    where: { id: userId, storeRoles: { some: { storeId } } },
    select: { id: true },
  });
  if (!user) throw new AttendanceDeviceError('That person does not work in this branch.');

  // Remember it (14 Oct 2026): the NEXT punch from this code is attributed
  // on arrival. Before this, only the punches already received were stamped
  // and every new one came in unmapped again.
  await db.attendanceCodeMap.upsert({
    where: { storeId_employeeCode: { storeId, employeeCode } },
    create: { storeId, employeeCode, userId, mappedBy },
    update: { userId, mappedBy, deletedAt: null },
  });

  // Which device the waiting punches came from - needed for the geofence the
  // replay applies, so a replayed punch is treated exactly as a live one.
  const sample = await db.attendancePunch.findFirst({
    where: { storeId, employeeCode, userId: null },
    select: {
      device: {
        select: {
          id: true, storeId: true, directionMode: true,
          defaultZone: { select: { lat: true, lng: true, isActive: true } },
        },
      },
    },
  });
  // Nothing waiting is fine now: the mapping above is what matters for the
  // punches still to come.
  if (!sample) return { received: 0, stored: 0, duplicates: 0, applied: 0, unmapped: 0, unusable: 0, openDays: 0, errors: [] };

  const d = sample.device;
  const { mapCodeToUser } = await import('./ingest');
  return mapCodeToUser(
    {
      id: d.id,
      storeId: d.storeId,
      directionMode: d.directionMode as 'from_state' | 'first_last',
      defaultZone: d.defaultZone && d.defaultZone.isActive
        ? { lat: Number(d.defaultZone.lat), lng: Number(d.defaultZone.lng) }
        : null,
    },
    employeeCode,
    userId,
  );
}

/**
 * Detach a code. The punches stay - they are evidence, and the machine really
 * did record them; only the attribution is withdrawn.
 */
export async function unmapCode(scope: StoreScope, employeeCode: string): Promise<number> {
  const storeId = scopeForWrite(scope);
  // Undone, not deleted: kept with no person, so later punches stay unmapped.
  await db.attendanceCodeMap.upsert({
    where: { storeId_employeeCode: { storeId, employeeCode } },
    create: { storeId, employeeCode, userId: null },
    update: { userId: null },
  });
  const r = await db.attendancePunch.updateMany({
    where: { storeId, employeeCode },
    data: { userId: null, appliedAt: null },
  });
  return r.count;
}

export interface CaptureHealthRow {
  deviceId: string;
  label: string;
  vendorLabel: string | null;
  lastPunchAt: Date | null;
  lastCalledAt: Date | null;
  punchesToday: number;
  unappliedCount: number;
  clockSkewSeconds: number | null;
  /** Nothing heard for long enough to be worth chasing. */
  silent: boolean;
  /** Every punch this device has ever delivered. */
  totalPunches: number;
  vendor: string | null;
  /**
   * The office connector, for pull vendors (9 Oct 2026) - its settings,
   * check-ins, last report and test, all managed from this screen.
   */
  agent: {
    settings: AgentSettings;
    version: string | null;
    seenAt: Date | null;
    status: (Omit<AgentStatusReport, 'test'>) | null;
    test: (AgentTestResult & { at: string }) | null;
    testRequestedAt: Date | null;
    /** The version Atlas offers, so the screen can say "updating". */
    latestVersion: string | null;
  };
}

const SILENT_AFTER_HOURS = 12;

export async function captureHealth(scope: StoreScope): Promise<CaptureHealthRow[]> {
  const devices = await db.attendanceDevice.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    select: {
      id: true, label: true, vendor: true, lastPunchAt: true, lastCalledAt: true,
      clockSkewSeconds: true,
      agentSettings: true, agentVersion: true, agentSeenAt: true, agentStatus: true,
      agentTest: true, testRequestedAt: true,
    },
  });
  if (devices.length === 0) return [];

  // Today in INDIA - the server's midnight is 05:30 IST on Vercel (9 Oct 2026).
  const since = startOfDay(new Date());
  const [today, unapplied, total] = await Promise.all([
    db.attendancePunch.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: devices.map((d) => d.id) }, punchAtUtc: { gte: since } },
      _count: { _all: true },
    }),
    db.attendancePunch.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: devices.map((d) => d.id) }, appliedAt: null },
      _count: { _all: true },
    }),
    db.attendancePunch.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: devices.map((d) => d.id) } },
      _count: { _all: true },
    }),
  ]);
  const totalBy = new Map(total.map((t) => [t.deviceId, t._count._all]));

  const todayBy = new Map(today.map((t) => [t.deviceId, t._count._all]));
  const unappliedBy = new Map(unapplied.map((t) => [t.deviceId, t._count._all]));
  const cutoff = Date.now() - SILENT_AFTER_HOURS * 3_600_000;

  return devices.map((d) => ({
    deviceId: d.id,
    label: d.label,
    vendorLabel: d.vendor,
    lastPunchAt: d.lastPunchAt,
    lastCalledAt: d.lastCalledAt,
    punchesToday: todayBy.get(d.id) ?? 0,
    unappliedCount: unappliedBy.get(d.id) ?? 0,
    clockSkewSeconds: d.clockSkewSeconds,
    // `lastCalledAt`, not `lastPunchAt`: a reader that is calling in and having
    // every punch rejected must not look the same as one that has gone dark.
    // That distinction has been in the schema since September.
    // A connector check-in counts too (9 Oct 2026): one that is running but
    // finding nothing in BioTime is not silent, it is "BioTime has nothing" -
    // and its last report says so.
    silent: Math.max(d.lastCalledAt?.getTime() ?? 0, d.agentSeenAt?.getTime() ?? 0) < cutoff,
    totalPunches: totalBy.get(d.id) ?? 0,
    vendor: d.vendor,
    agent: {
      settings: cleanAgentSettings(d.agentSettings),
      version: d.agentVersion,
      seenAt: d.agentSeenAt,
      status: (d.agentStatus as Omit<AgentStatusReport, 'test'> | null) ?? null,
      test: (d.agentTest as (AgentTestResult & { at: string }) | null) ?? null,
      testRequestedAt: d.testRequestedAt,
      latestVersion: AGENT_RELEASE?.version ?? null,
    },
  }));
}

export { ingestNormalisedPunches };
