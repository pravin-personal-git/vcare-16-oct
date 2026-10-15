import 'server-only';
import { CallLogError } from './call-log-error';
// Shift attribution. `shifts.ts` imports only a TYPE back from this module, and
// types are erased, so there is no runtime cycle between the two.
import { shiftForCall, shiftsCovering } from './shifts';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { db } from './db';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { requestIp, setActor } from './audit-context';
import { callHealth, parseCallSyncState, clockSkewed, deviceStatus, parsePermissionState, type CallHealth, type DeviceStatus } from '@/lib/device-trust';
import { resolveForUser } from './app-access';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import {
  applyCaptureMode, contentKey, metricsFor, neverConnected, prepareCall, staleness,
  type CallMetrics, type CaptureMode, type IncomingCall,
} from '@/lib/call-log';

/**
 * Call logs - pairing phones, taking what they send, and reading it back.
 *
 * THE PHONE IS NOT A BROWSER
 *
 * Everything else in this codebase authenticates a *person* through a cookie.
 * A phone has no cookie and no login screen - the employee signs in once, at
 * pairing, and after that the app runs unattended for months. So the unit of
 * trust is the DEVICE, holding a token of its own that can be revoked the
 * moment a handset is lost or someone leaves.
 *
 * That token never appears in the database. Only its SHA-256 hash is stored, so
 * a leaked database cannot be used to post fabricated call logs.
 *
 * INGEST IS IDEMPOTENT, AND HAS TO BE
 *
 * A phone that loses signal mid-sync will send the same batch again. A phone
 * that was killed for two days sends a large catch-up that overlaps whatever
 * did get through. Every call therefore carries a content hash with a unique
 * constraint behind it, and re-sending is simply a no-op. The app is free to be
 * dumb about what it has already sent, which is exactly what you want in code
 * running on a phone you cannot debug.
 *
 * Spec: 01-product/CALL-LOG-PLATFORM.md
 */

// Lives in its own file so that `shifts.ts` can throw it without importing this
// module at runtime - see the note there. Re-exported because the API routes
// have always imported it from here and there is no reason to churn them.
export { CallLogError } from './call-log-error';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** How long a pairing code is worth typing. Short: it is a standing credential. */
const PAIRING_TTL_MIN = 30;

/**
 * No `0`/`O`, no `1`/`I`. The code is read off a screen and typed on a phone
 * keyboard by someone who did not choose to be doing this, and a support call
 * about a mistyped `0` costs more than the four characters it saves.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pairingCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

// ------------------------------------------------------------------ pairing

export interface DeviceRow {
  id: string;
  userId: string;
  userName: string;
  deviceLabel: string | null;
  deviceModel: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  lastSyncedAt: Date | null;
  lastCallAt: Date | null;
  isActive: boolean;
  pairedAt: Date;
  /** Set only while a code is live and unused. */
  pairingCode: string | null;
  pairingExpiresAt: Date | null;
  callCount: number;
  /** Vcare device trust - lib/device-trust. */
  status: DeviceStatus;
  flags: DeviceFlag[];
  pairedByName: string | null;
  /** Last 4 characters only - enough to tell two phones apart, not to copy. */
  androidIdTail: string | null;
  lastIp: string | null;
  /** The branch the phone is paired to - its calls are matched to that branch's customers. */
  storeName: string;
  /** Why it does or does not show calls, in one sentence (lib/device-trust callHealth). */
  callHealth: CallHealth;
}

/** What needs the admin's attention on a phone, beyond its status. */
export type DeviceFlag = 'location_off' | 'permissions_missing' | 'battery_restricted' | 'clock_changed' | 'fake_gps' | 'integrity';

export async function listDevices(scope: StoreScope): Promise<DeviceRow[]> {
  const rows = await db.callSyncDevice.findMany({
    where: { ...scopeWhere(scope) },
    orderBy: [{ isActive: 'desc' }, { lastSyncedAt: 'desc' }],
    select: {
      id: true, userId: true, deviceLabel: true, deviceModel: true,
      androidVersion: true, appVersion: true, lastSyncedAt: true, lastCallAt: true,
      isActive: true, pairedAt: true, pairingCode: true, pairingExpiresAt: true,
      appRemovedAt: true, permissionState: true, clockSkewMs: true, mockLocationSeenAt: true,
      integrityVerdict: true, androidId: true, lastIp: true, createdBy: true,
      lastSyncAccepted: true, lastSyncSkipped: true, storeId: true, lastCallCheckAt: true, lastCallSyncError: true, callSyncState: true,
      store: { select: { name: true, callCaptureMode: true } },
      user: { select: { fullName: true } },
      _count: { select: { calls: true } },
    },
  });

  // Who is on shift right now decides how long a phone may stay quiet (15 min
  // on shift, 12 h off) - an open attendance session is a shift in progress.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const [open, creators] = await Promise.all([
    userIds.length
      ? db.attendanceSession.findMany({
        where: { ...scopeWhere(scope), userId: { in: userIds }, endedAt: null },
        select: { userId: true },
      })
      : Promise.resolve([]),
    creatorIds.length
      ? db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
      : Promise.resolve([]),
  ]);
  const onShift = new Set(open.map((o) => o.userId));
  // Call reading switched off per person (Phone app access), per branch.
  const tracking = new Map<string, boolean>();
  for (const d of rows) {
    const k = `${d.userId}:${d.storeId}`;
    if (!tracking.has(k)) tracking.set(k, (await resolveForUser(d.userId, [d.storeId])).tracking.callLog);
  }
  const when = (x: Date) => x.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const creatorName = new Map(creators.map((u) => [u.id, u.fullName]));
  const now = new Date();
  const DAY = 24 * 60 * 60_000;

  return rows.map((d) => ({
    id: d.id,
    userId: d.userId,
    userName: d.user.fullName,
    deviceLabel: d.deviceLabel,
    deviceModel: d.deviceModel,
    androidVersion: d.androidVersion,
    appVersion: d.appVersion,
    lastSyncedAt: d.lastSyncedAt,
    lastCallAt: d.lastCallAt,
    isActive: d.isActive,
    pairedAt: d.pairedAt,
    // An expired code is not shown as a code. Offering a dead one to type is
    // worse than offering none.
    pairingCode: d.pairingExpiresAt && d.pairingExpiresAt > new Date() ? d.pairingCode : null,
    pairingExpiresAt: d.pairingExpiresAt,
    callCount: d._count.calls,
    status: deviceStatus(d, onShift.has(d.userId), now),
    flags: deviceFlags(d, now, DAY),
    pairedByName: d.createdBy ? creatorName.get(d.createdBy) ?? null : null,
    androidIdTail: d.androidId ? d.androidId.slice(-4) : null,
    lastIp: d.lastIp,
    storeName: d.store.name,
    callHealth: callHealth({
      isActive: d.isActive,
      trackingOn: tracking.get(`${d.userId}:${d.storeId}`) ?? true,
      permission: parsePermissionState(d.permissionState),
      lastSyncedAt: d.lastSyncedAt,
      lastCallCheckAt: d.lastCallCheckAt,
      lastCallSyncError: d.lastCallSyncError,
      phoneReport: parseCallSyncState(d.callSyncState),
      lastSyncAccepted: d.lastSyncAccepted,
      lastSyncSkipped: d.lastSyncSkipped,
      captureMode: d.store.callCaptureMode === 'all' ? 'all' : 'crm_only',
      storeName: d.store.name,
    }, when),
  }));
}

function deviceFlags(
  d: { permissionState: unknown; clockSkewMs: number | null; mockLocationSeenAt: Date | null; integrityVerdict: string | null; isActive: boolean },
  now: Date,
  day: number,
): DeviceFlag[] {
  if (!d.isActive) return [];
  const out: DeviceFlag[] = [];
  const p = parsePermissionState(d.permissionState);
  if (p) {
    if (p.location !== 'always' || !p.locationServices) out.push('location_off');
    if (!p.callLog || !p.notifications) out.push('permissions_missing');
    if (!p.batteryUnrestricted) out.push('battery_restricted');
  }
  if (clockSkewed(d.clockSkewMs)) out.push('clock_changed');
  // A fake location in the last day is still news; older ones are history.
  if (d.mockLocationSeenAt && now.getTime() - d.mockLocationSeenAt.getTime() < day) out.push('fake_gps');
  if (d.integrityVerdict && d.integrityVerdict !== 'ok') out.push('integrity');
  return out;
}

/**
 * Create a device slot and a code for someone to type into their phone.
 *
 * The device row exists before the phone does. That is deliberate: a manager
 * decides *whose* phone this is, from the web, where they know who is who. The
 * phone then only proves it holds the code - it never gets to claim an identity.
 */
export async function createPairing(
  scope: StoreScope,
  userId: string,
  label: string | null,
  createdBy: string,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const storeId = scopeForWrite(scope);

  const user = await db.user.findFirst({
    where: { id: userId, storeRoles: { some: { storeId } } },
    select: { id: true, fullName: true, isActive: true },
  });
  if (!user) throw new CallLogError('That user does not belong to this store.');
  if (!user.isActive) throw new CallLogError(`${user.fullName} is deactivated.`);

  const code = pairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MIN * 60_000);

  // A placeholder token hash so the unique constraint holds before the phone
  // ever connects. It is unguessable and is replaced on pairing.
  const placeholder = hash(`unpaired:${randomBytes(32).toString('hex')}`);

  const device = await db.callSyncDevice.create({
    data: {
      storeId,
      userId,
      tokenHash: placeholder,
      pairingCode: code,
      pairingExpiresAt: expiresAt,
      deviceLabel: label,
      createdBy,
      // Never synced yet - `lastSyncedAt` stays null, which the UI reads as
      // "Never reported" rather than as silence.
    },
    select: { id: true },
  });

  return { id: device.id, code, expiresAt };
}

export interface PairResult {
  token: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  storeName: string;
  captureMode: CaptureMode;
}

/**
 * The phone exchanges a typed code for its long-lived token. Called from the
 * API route, with no session - the code IS the authentication.
 */
export async function redeemPairing(
  code: string,
  device: {
    model?: string | null; androidVersion?: string | null; appVersion?: string | null;
    /** Vcare sends the phone's ANDROID_ID; the retired Call Sync app did not. */
    androidId?: string | null; ip?: string | null;
  },
): Promise<PairResult> {
  const normalised = code.trim().toUpperCase();
  if (!normalised) throw new CallLogError('Enter the pairing code.');

  const row = await db.callSyncDevice.findUnique({
    where: { pairingCode: normalised },
    select: {
      id: true, userId: true, storeId: true, pairingExpiresAt: true, isActive: true,
      user: { select: { fullName: true, email: true, isActive: true } },
      store: { select: { name: true, callCaptureMode: true } },
    },
  });

  // One message for "wrong code" and "expired code" would be friendlier and
  // would also tell someone guessing codes when they had found a real one.
  if (!row) throw new CallLogError('That code is not valid. Ask for a new one.');
  if (!row.pairingExpiresAt || row.pairingExpiresAt < new Date()) {
    throw new CallLogError('That code has expired. Ask for a new one.');
  }
  if (!row.isActive) throw new CallLogError('This device has been revoked.');
  if (!row.user.isActive) throw new CallLogError('That user account is deactivated.');

  const token = randomBytes(32).toString('hex');
  const androidId = device.androidId?.trim().slice(0, 64) || null;

  // One phone per employee (decided 24 Sep 2026): pairing this phone switches
  // off every other phone paired to the same person, in the same transaction,
  // and says so in each phone's history.
  await db.$transaction(async (tx) => {
    await tx.callSyncDevice.update({
      where: { id: row.id },
      data: {
        tokenHash: hash(token),
        // Cleared immediately. A pairing code that stays valid after use is a
        // second, weaker credential that nobody remembers exists.
        pairingCode: null,
        pairingExpiresAt: null,
        deviceModel: device.model ?? null,
        androidVersion: device.androidVersion ?? null,
        appVersion: device.appVersion ?? null,
        androidId,
        lastIp: device.ip ?? null,
        appRemovedAt: null,
        pairedAt: new Date(),
      },
    });
    const others = await tx.callSyncDevice.findMany({
      where: { userId: row.userId, isActive: true, id: { not: row.id } },
      select: { id: true, storeId: true },
    });
    if (others.length) {
      await tx.callSyncDevice.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { isActive: false, revokedAt: new Date(), pairingCode: null },
      });
      await tx.deviceEvent.createMany({
        data: others.map((o) => ({
          storeId: o.storeId, deviceId: o.id, userId: row.userId, kind: 'replaced',
          detail: { replacedBy: row.id, model: device.model ?? null },
        })),
      });
    }
    await tx.deviceEvent.create({
      data: {
        storeId: row.storeId, deviceId: row.id, userId: row.userId, kind: 'paired',
        detail: { model: device.model ?? null, androidVersion: device.androidVersion ?? null, androidId, replaced: others.length },
      },
    });
  });

  return {
    token,
    userId: row.userId,
    userName: row.user.fullName,
    // THE HANDSET LEARNS WHOSE IT IS, NOT JUST WHAT IT IS CALLED.
    //
    // Pairing already proved this phone belongs to the company. The email is
    // what lets the app also insist that the HR account signed in on it is the
    // same person the phone was issued to -- without it, any HR account,
    // including an administrator's, could sign in on anybody's handset and
    // leave a token there.
    userEmail: row.user.email,
    storeName: row.store.name,
    captureMode: row.store.callCaptureMode === 'all' ? 'all' : 'crm_only',
  };
}

export interface AuthedDevice {
  id: string;
  storeId: string;
  userId: string;
  captureMode: CaptureMode;
  lastCallAt: Date | null;
}

/** Resolve a bearer token to a device. Null for anything not currently valid. */
export async function deviceFromToken(token: string): Promise<AuthedDevice | null> {
  if (!token) return null;

  const row = await db.callSyncDevice.findUnique({
    where: { tokenHash: hash(token) },
    select: {
      id: true, storeId: true, userId: true, isActive: true, lastCallAt: true,
      user: { select: { isActive: true } },
      store: { select: { callCaptureMode: true, isActive: true } },
    },
  });

  if (!row || !row.isActive || !row.user.isActive || !row.store.isActive) return null;

  // Writes made on the strength of this phone's token are the employee's (AUD-1).
  await setActor({ id: row.userId, kind: 'device', via: 'Vcare', ip: await requestIp(), storeId: row.storeId });

  return {
    id: row.id,
    storeId: row.storeId,
    userId: row.userId,
    captureMode: row.store.callCaptureMode === 'all' ? 'all' : 'crm_only',
    lastCallAt: row.lastCallAt,
  };
}

/**
 * Record that a phone checked in, without it having sent anything.
 *
 * THE BUG THIS FIXES, 7 Sep 2026.
 *
 * `lastSyncedAt` was only written by `ingestCalls`, and the Android app only
 * POSTs when it actually has calls to send - a phone with nothing new does a
 * GET and stops. So a correctly working, freshly paired phone reported
 * "Never reported / Not reporting" on the Devices screen, in red, next to a
 * warning telling the manager to go and fix the employee's battery settings.
 *
 * The comment in `ingestCalls` claimed a phone reporting no new calls must not
 * look like a phone that had been killed. It was right about the requirement
 * and wrong about where to meet it: the quiet phone never reached that code.
 *
 * Fixed here rather than in the app, deliberately. The server address and this
 * behaviour are both compiled into every APK in the field; a phone fix reaches
 * only handsets someone reinstalls. `lastSyncedAt` means "when did this phone
 * last talk to us", and a GET is the phone talking to us, so this is also the
 * more honest reading of the column.
 */
export async function touchDevice(deviceId: string): Promise<void> {
  await db.callSyncDevice.update({
    where: { id: deviceId },
    data: { lastSyncedAt: new Date() },
  });
}

export async function revokeDevice(
  scope: StoreScope,
  deviceId: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const updated = await db.callSyncDevice.updateMany({
    where: { id: deviceId, storeId },
    data: { isActive: false, revokedAt: new Date(), revokedBy: userId, pairingCode: null },
  });
  if (updated.count === 0) throw new CallLogError('Device not found in your scope.');

  // Calls already reported are kept. They are a record of work that happened,
  // and deleting them because a handset was replaced would lose history nobody
  // asked to lose.
}

// ------------------------------------------------------------------- ingest

export interface IngestResult {
  accepted: number;
  duplicates: number;
  /** Rejected by the store's capture mode - not an error. */
  skippedByPolicy: number;
  /** Unusable rows: no number, impossible timestamp. */
  invalid: number;
  serverTime: string;
  /** The newest call we now hold, so the phone knows where to resume. */
  lastCallAt: string | null;
}

/**
 * Take a batch of calls from one phone.
 *
 * Every figure comes back in the result because the app has no other way to
 * find out what happened to what it sent, and "sent 40, accepted 3" is the
 * difference between a working install and a misconfigured one.
 */
export async function ingestCalls(
  device: AuthedDevice,
  incoming: IncomingCall[],
): Promise<IngestResult> {
  const now = new Date();

  if (incoming.length > 1000) {
    throw new CallLogError('Too many calls in one batch. Send at most 1000.');
  }

  const prepared = incoming.map(prepareCall);
  const valid = prepared.filter((p): p is NonNullable<typeof p> => p !== null);
  const invalid = prepared.length - valid.length;

  // CRM numbers for this store, normalised the same way the calls are.
  // Fetched per batch rather than cached: a number added to the CRM this
  // morning must match this afternoon's calls.
  const crmNumbers = await crmNumberSet(device.storeId);

  const { kept, skipped } = applyCaptureMode(valid, device.captureMode, crmNumbers);

  let accepted = 0;
  let newest: Date | null = device.lastCallAt;

  if (kept.length > 0) {
    /**
     * Which shift each call fell inside.
     *
     * Fetched once for the whole batch rather than per call - a catch-up sync
     * can carry 500 calls, and 500 round trips on a `connection_limit=1` pool
     * would take longer than the request is allowed to live.
     *
     * Matching is by TIME RANGE, not "the shift that is open now". A call made
     * at 18:50 routinely arrives after the 19:03 shift end, and asking which
     * shift is open would file it under the following day.
     */
    const times = kept.map((c) => c.startedAtMs);
    const shifts = await shiftsCovering(
      device.id,
      new Date(Math.min(...times)),
      new Date(Math.max(...times)),
    );

    const rows = kept.map((c) => {
      const startedAt = new Date(c.startedAtMs);
      const shift = shiftForCall(shifts, startedAt);
      return {
        storeId: device.storeId,
        deviceId: device.id,
        userId: device.userId,
        sessionId: shift?.id ?? null,
        // Q21: kept, but flagged, so it never lands in the headline figure.
        outsideShift: shift === null,
        rawNumber: c.rawNumber,
        e164Number: c.e164Number,
        direction: c.direction,
        startedAt,
        durationSec: c.durationSec,
        matchedCrm: c.matchedCrm,
        contentHash: hash(contentKey({
          deviceId: device.id,
          e164Number: c.e164Number,
          startedAtMs: c.startedAtMs,
          durationSec: c.durationSec,
          direction: c.direction,
        })),
        syncedAt: now,
      };
    });

    // `skipDuplicates` rather than a check-then-insert. The unique index on
    // (storeId, contentHash) is what actually guarantees this, and doing it in
    // one statement means a phone re-sending an overlapping catch-up batch
    // cannot race with itself.
    const written = await db.callLog.createMany({ data: rows, skipDuplicates: true });
    accepted = written.count;

    for (const r of rows) {
      if (!newest || r.startedAt > newest) newest = r.startedAt;
    }
  }

  /**
   * The marker moves past every call the phone SENT, kept or not (health
   * check CALL-2, 25 Sep 2026). It used to move only for kept calls, so in
   * "CRM numbers only" mode a skipped call left it behind and the phone
   * re-sent the same days of calls on every sync.
   */
  for (const v of valid) {
    const at = new Date(v.startedAtMs);
    if (!newest || at > newest) newest = at;
  }

  // `lastSyncedAt` is written on EVERY sync, including one that accepted
  // nothing. That is the point of it: a phone reporting "no new calls" is
  // healthy, and must not look the same as a phone that has been killed.
  await db.callSyncDevice.update({
    where: { id: device.id },
    data: { lastSyncedAt: now, lastCallAt: newest, lastSyncAccepted: accepted, lastSyncSkipped: skipped, lastCallSyncError: null },
  });

  return {
    accepted,
    duplicates: kept.length - accepted,
    skippedByPolicy: skipped,
    invalid,
    serverTime: now.toISOString(),
    lastCallAt: newest ? newest.toISOString() : null,
  };
}

/**
 * Every phone number the CRM knows, normalised for comparison.
 *
 * Both `phone` and `altPhone`, because a customer reached on their second
 * number is still a customer and a call to it should not be discarded as
 * personal.
 */
async function crmNumberSet(storeId: string): Promise<Set<string>> {
  const parties = await db.party.findMany({
    where: { storeId },
    select: { phone: true, altPhone: true },
  });

  const out = new Set<string>();
  for (const p of parties) {
    for (const n of [p.phone, p.altPhone]) {
      if (!n) continue;
      const digits = n.replace(/\D/g, '');
      const key = digits.length > 10 ? digits.slice(-10) : digits;
      if (key) out.add(key);
    }
  }
  return out;
}

// ------------------------------------------------------------------ reading

export interface CallLogRow {
  id: string;
  userId: string;
  userName: string;
  rawNumber: string;
  e164Number: string;
  direction: string;
  startedAt: Date;
  durationSec: number;
  matchedCrm: boolean;
  /** Resolved on read, never stored - see the schema comment on `matchedCrm`. */
  partyId: string | null;
  partyName: string | null;
  syncedAt: Date;
}

export interface CallLogFilters {
  userId?: string;
  /**
   * Only calls from staff in these departments.
   *
   * This is what makes the Services Call screen possible without capturing
   * anything new: a service engineer's phone is already reporting, and the
   * only difference between "call logs" and "service calls" is which team the
   * person is on. One filter, no second pipeline, no second app to install.
   */
  userIds?: string[];
  from?: Date;
  to?: Date;
  direction?: string;
  /** Only calls to numbers that are in the CRM today. */
  crmOnly?: boolean;
  take?: number;
}

export async function listCalls(
  scope: StoreScope,
  f: CallLogFilters = {},
): Promise<CallLogRow[]> {
  const rows = await db.callLog.findMany({
    where: {
      ...scopeWhere(scope),
      ...(f.userId ? { userId: f.userId } : {}),
      // An EMPTY array must match nothing, not everything. A department with no
      // staff in it should show an empty screen - `{ in: [] }` does exactly
      // that, whereas omitting the clause would quietly show the whole company.
      ...(f.userIds ? { userId: { in: f.userIds } } : {}),
      ...(f.direction ? { direction: f.direction } : {}),
      ...(f.crmOnly ? { matchedCrm: true } : {}),
      ...(f.from || f.to
        ? { startedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
        : {}),
    },
    orderBy: { startedAt: 'desc' },
    take: f.take ?? 500,
    select: {
      id: true, userId: true, rawNumber: true, e164Number: true, direction: true,
      startedAt: true, durationSec: true, matchedCrm: true, syncedAt: true,
      user: { select: { fullName: true } },
    },
  });

  const byNumber = await partyLookup(scope, rows.map((r) => r.e164Number));

  return rows.map((r) => {
    const party = byNumber.get(r.e164Number);
    return {
      id: r.id,
      userId: r.userId,
      userName: r.user.fullName,
      rawNumber: r.rawNumber,
      e164Number: r.e164Number,
      direction: r.direction,
      startedAt: r.startedAt,
      durationSec: r.durationSec,
      matchedCrm: r.matchedCrm,
      partyId: party?.id ?? null,
      partyName: party?.name ?? null,
      syncedAt: r.syncedAt,
    };
  });
}

/**
 * Numbers to customers, resolved at read time.
 *
 * Deliberately not a stored `partyId` on the call. A number that becomes a
 * customer next month should light up against calls made to it last month -
 * that retroactive link is most of the value of putting call logs next to a CRM
 * at all, and a foreign key written at ingest would freeze it forever.
 */
async function partyLookup(
  scope: StoreScope,
  numbers: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (numbers.length === 0) return out;

  const parties = await db.party.findMany({
    where: { ...scopeWhere(scope) },
    select: {
      id: true, phone: true, altPhone: true,
      companyName: true, title: true, firstName: true, lastName: true,
    },
  });

  const wanted = new Set(numbers);
  for (const p of parties) {
    const name = p.companyName
      ?? [p.title, p.firstName, p.lastName].filter(Boolean).join(' ');
    for (const n of [p.phone, p.altPhone]) {
      if (!n) continue;
      const digits = n.replace(/\D/g, '');
      const key = digits.length > 10 ? digits.slice(-10) : digits;
      if (key && wanted.has(key) && !out.has(key)) out.set(key, { id: p.id, name });
    }
  }
  return out;
}

export interface EmployeeCallSummary {
  userId: string;
  userName: string;
  metrics: CallMetrics;
  lastSyncedAt: Date | null;
  staleLabel: string;
  staleWarn: boolean;
  neverConnectedCount: number;
}

/** The manager's screen: one row per person, with the health of their phone. */
export async function summaryByEmployee(
  scope: StoreScope,
  from: Date,
  to: Date,
): Promise<EmployeeCallSummary[]> {
  const [calls, devices] = await db.$transaction([
    db.callLog.findMany({
      where: { ...scopeWhere(scope), startedAt: { gte: from, lte: to } },
      select: {
        userId: true, e164Number: true, direction: true, startedAt: true,
        durationSec: true, matchedCrm: true,
        user: { select: { fullName: true } },
      },
    }),
    db.callSyncDevice.findMany({
      where: { ...scopeWhere(scope), isActive: true },
      select: { userId: true, lastSyncedAt: true, user: { select: { fullName: true } } },
    }),
  ]);

  // Keyed on every person who has a device OR made a call. Someone whose phone
  // has never reported must still appear - with zero calls and a warning -
  // rather than vanishing from the list, which would hide the problem.
  const names = new Map<string, string>();
  for (const d of devices) names.set(d.userId, d.user.fullName);
  for (const c of calls) names.set(c.userId, c.user.fullName);

  const lastSync = new Map<string, Date | null>();
  for (const d of devices) {
    const prev = lastSync.get(d.userId);
    if (prev === undefined || (d.lastSyncedAt && (!prev || d.lastSyncedAt > prev))) {
      lastSync.set(d.userId, d.lastSyncedAt);
    }
  }

  const out: EmployeeCallSummary[] = [];
  for (const [userId, userName] of names) {
    const mine = calls.filter((c) => c.userId === userId);
    const s = staleness(lastSync.get(userId) ?? null);
    out.push({
      userId,
      userName,
      metrics: metricsFor(mine),
      lastSyncedAt: lastSync.get(userId) ?? null,
      staleLabel: s.label,
      staleWarn: s.warn,
      neverConnectedCount: neverConnected(mine).length,
    });
  }

  return out.sort((a, b) => b.metrics.connectedOutgoing - a.metrics.connectedOutgoing);
}

export async function getCaptureMode(scope: StoreScope): Promise<CaptureMode> {
  const storeId = scopeForWrite(scope);
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { callCaptureMode: true },
  });
  return store?.callCaptureMode === 'all' ? 'all' : 'crm_only';
}

export async function setCaptureMode(scope: StoreScope, mode: CaptureMode): Promise<void> {
  const storeId = scopeForWrite(scope);
  await db.store.update({ where: { id: storeId }, data: { callCaptureMode: mode } });
}

export interface PartyCall { id: string; userName: string; direction: string; startedAt: Date; durationSec: number }

/**
 * Calls between staff and one customer since a moment - shown on a complaint
 * (27 Sep 2026, streamline S4): the technician's Call button only opens the
 * dialer, and the call reaches Atlas with the phone's next sync, so the
 * complaint shows it from the call log rather than from the tap.
 */
export async function callsWithParty(scope: StoreScope, partyId: string, since: Date): Promise<PartyCall[]> {
  const party = await db.party.findFirst({ where: { id: partyId, ...scopeWhere(scope) }, select: { phone: true, altPhone: true } });
  if (!party) return [];
  const keys = [party.phone, party.altPhone]
    .map((n) => (n ?? '').replace(/\D/g, ''))
    .map((d) => (d.length > 10 ? d.slice(-10) : d))
    .filter((k) => k.length >= 6);
  if (!keys.length) return [];
  const rows = await db.callLog.findMany({
    where: { ...scopeWhere(scope), e164Number: { in: keys }, startedAt: { gte: since } },
    orderBy: { startedAt: 'desc' }, take: FEED_MAX_ROWS,
    select: { id: true, direction: true, startedAt: true, durationSec: true, user: { select: { fullName: true } } },
  });
  return rows.map((r) => ({ id: r.id, userName: r.user.fullName, direction: r.direction, startedAt: r.startedAt, durationSec: r.durationSec }));
}
