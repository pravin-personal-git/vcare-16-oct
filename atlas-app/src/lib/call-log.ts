/**
 * Call logs - the rules, without a database.
 *
 * Three things carry this module, and each of them is a place where a naive
 * implementation looks fine in a demo and fails on real phones.
 *
 * 1. PHONE NUMBERS ARE NOT STRINGS
 *
 * `+91 98765 43210`, `098765 43210`, `9876543210` and `+919876543210` are one
 * customer. Compared as text they are four. Matching call logs to the CRM by
 * string equality is the single most common way this feature "works" in testing
 * and then matches almost nothing in production, because the CRM was typed by a
 * human and the call log came from a SIM.
 *
 * 2. THE PHONE'S OWN CALL ID CANNOT BE TRUSTED
 *
 * Android gives every call a `CallLog.Calls._ID`. It is local to the handset and
 * **reused after a factory reset**, so two genuinely different calls can arrive
 * carrying the same id. Deduplicating on it silently drops real calls. The key
 * here is a hash of the call's own content instead - which cannot collide unless
 * the calls really are identical.
 *
 * 3. A SILENT PHONE IS NOT AN IDLE EMPLOYEE
 *
 * When Android kills the app - and on Xiaomi, Oppo, Vivo and Realme it will -
 * the calls stop arriving. If the screen shows "0 calls" the manager reads it as
 * a lazy salesperson. `staleness()` exists so every count can be shown next to
 * how long ago that phone last reported, and the difference is the whole
 * credibility of the feature.
 *
 * Pure - no database, no `server-only`. The Android app, the browser and the
 * server all agree because they all use this.
 *
 * Spec: 01-product/CALL-LOG-PLATFORM.md
 */

// ---------------------------------------------------------------- direction

export type CallDirection =
  | 'outgoing' | 'incoming' | 'missed' | 'rejected' | 'blocked' | 'unknown';

export const CALL_DIRECTIONS: { value: CallDirection; label: string; connects: boolean }[] = [
  { value: 'outgoing', label: 'Outgoing', connects: true },
  { value: 'incoming', label: 'Incoming', connects: true },
  { value: 'missed', label: 'Missed', connects: false },
  { value: 'rejected', label: 'Rejected', connects: false },
  { value: 'blocked', label: 'Blocked', connects: false },
  { value: 'unknown', label: 'Unknown', connects: false },
];

export const DIRECTION_LABEL: Record<string, string> =
  Object.fromEntries(CALL_DIRECTIONS.map((d) => [d.value, d.label]));

/**
 * Android's `CallLog.Calls.TYPE` constants, mapped to our names.
 *
 * Numbers rather than an enum because that is literally what the phone sends.
 * Anything unrecognised becomes `unknown` rather than being dropped - a call
 * that happened is worth recording even when we cannot classify it, and newer
 * Android versions add types.
 */
export function directionFromAndroidType(type: number): CallDirection {
  switch (type) {
    case 1: return 'incoming';
    case 2: return 'outgoing';
    case 3: return 'missed';
    case 5: return 'rejected';
    case 6: return 'blocked';
    default: return 'unknown';
  }
}

/** Did anyone actually speak? Drives talk time and "attempted but never reached". */
export function didConnect(direction: string, durationSec: number): boolean {
  return durationSec > 0
    && (direction === 'outgoing' || direction === 'incoming');
}

// ------------------------------------------------------------ phone numbers

/**
 * Reduce a number to the form used for matching.
 *
 * India-first, because that is the market: keep the last 10 digits and drop the
 * country code, the leading 0, and every space, dash and bracket. `+91 98765
 * 43210` and `098765 43210` both become `9876543210`.
 *
 * Deliberately NOT a full E.164 implementation. A real one needs a library and
 * a country context this app does not have, and would fail differently - the
 * goal here is not a canonical international number, it is *two numbers that
 * are the same customer comparing equal*.
 *
 * Short codes and non-numbers are returned as their digits, so `*99#` and
 * `12345` still group with themselves rather than all collapsing to one bucket.
 */
export function normaliseNumber(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 0) return '';

  // Indian mobile numbers are 10 digits. Anything longer is carrying a country
  // code or a trunk prefix in front of one.
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/** Private, withheld, or a phone that reported nothing. */
export function isUnknownNumber(raw: string): boolean {
  return normaliseNumber(raw).length === 0;
}

/**
 * Readable form for a screen. `98765 43210`, not `9876543210`.
 *
 * Only for display - never store this or compare on it.
 */
export function formatNumber(e164: string): string {
  if (e164.length === 10) return `${e164.slice(0, 5)} ${e164.slice(5)}`;
  return e164;
}

// ------------------------------------------------------------------ dedupe

export interface CallForHash {
  deviceId: string;
  e164Number: string;
  /** Milliseconds since epoch, as the phone reported it. */
  startedAtMs: number;
  durationSec: number;
  direction: string;
}

/**
 * The stable identity of a call.
 *
 * `startedAtMs` is rounded to the second before hashing. Android reports
 * milliseconds, but the same call read twice - once from a live sync, once from
 * a catch-up after the app was killed - can differ by a millisecond or two in
 * the phone's own record. Hashing the raw value would then produce two hashes
 * for one call and the manager would see every conversation twice.
 *
 * Returns the input string for hashing; the caller applies SHA-256, because
 * `node:crypto` is not available in every place this module is imported.
 */
export function contentKey(c: CallForHash): string {
  const second = Math.floor(c.startedAtMs / 1000);
  return [c.deviceId, c.e164Number, second, c.durationSec, c.direction].join('|');
}

// ------------------------------------------------------------------ ingest

export interface IncomingCall {
  number: string;
  /** Android `CallLog.Calls.TYPE`, or one of our own direction strings. */
  type?: number;
  direction?: string;
  startedAtMs: number;
  durationSec: number;
}

export interface PreparedCall {
  rawNumber: string;
  e164Number: string;
  direction: CallDirection;
  startedAtMs: number;
  durationSec: number;
}

export type CaptureMode = 'crm_only' | 'all';

export const CAPTURE_MODES: { value: CaptureMode; label: string; hint: string }[] = [
  {
    value: 'crm_only',
    label: 'Only calls to people in the CRM',
    hint: 'Calls to numbers that are not customers, leads or suppliers are never sent or stored. Staff keep their private calls private.',
  },
  {
    value: 'all',
    label: 'Every call on the phone',
    hint: 'Includes personal calls. Tell your staff before switching this on - it is their phone.',
  },
];

/**
 * Clean one call off the wire.
 *
 * Returns null for anything unusable rather than throwing: a phone syncing 400
 * calls must not have the whole batch rejected because one row had a blank
 * number. The rest still land, and the bad one is simply not recorded.
 */
export function prepareCall(c: IncomingCall): PreparedCall | null {
  const rawNumber = (c.number ?? '').trim();
  const e164Number = normaliseNumber(rawNumber);
  if (!e164Number) return null;

  if (!Number.isFinite(c.startedAtMs) || c.startedAtMs <= 0) return null;

  // A call from the future is a phone with a wrong clock. One day of tolerance
  // covers timezone confusion; beyond that the timestamp is not usable and
  // would sort above every real call forever.
  if (c.startedAtMs > Date.now() + 86_400_000) return null;

  const direction: CallDirection = typeof c.type === 'number'
    ? directionFromAndroidType(c.type)
    : (CALL_DIRECTIONS.some((d) => d.value === c.direction)
      ? c.direction as CallDirection
      : 'unknown');

  return {
    rawNumber,
    e164Number,
    direction,
    startedAtMs: c.startedAtMs,
    // Negative durations exist in the wild on some OEM ROMs.
    durationSec: Math.max(0, Math.trunc(c.durationSec || 0)),
  };
}

/**
 * Which prepared calls survive the store's capture mode.
 *
 * Applied at INGEST, not on read. A call that is not kept is never written, so
 * switching a store to `crm_only` later cannot expose what was already
 * collected under `all` - and switching to `all` does not retroactively reveal
 * calls the phone never sent. The setting means what it says at the moment it
 * is set, which is the only version of it that can be explained to staff.
 */
export function applyCaptureMode(
  calls: PreparedCall[],
  mode: CaptureMode,
  crmNumbers: Set<string>,
): { kept: (PreparedCall & { matchedCrm: boolean })[]; skipped: number } {
  const out: (PreparedCall & { matchedCrm: boolean })[] = [];
  let skipped = 0;

  for (const c of calls) {
    const matchedCrm = crmNumbers.has(c.e164Number);
    if (mode === 'crm_only' && !matchedCrm) { skipped += 1; continue; }
    out.push({ ...c, matchedCrm });
  }

  return { kept: out, skipped };
}

// ----------------------------------------------------------------- metrics

export interface CallRow {
  userId: string;
  e164Number: string;
  direction: string;
  startedAt: Date;
  durationSec: number;
  matchedCrm: boolean;
}

export interface CallMetrics {
  total: number;
  outgoing: number;
  incoming: number;
  /** Missed, rejected and blocked together - nobody spoke. */
  notConnected: number;
  /** Outgoing calls that connected. The number a sales manager actually wants. */
  connectedOutgoing: number;
  talkTimeSec: number;
  /** Distinct people, not distinct calls. Ten calls to one person is one contact. */
  uniqueNumbers: number;
  crmNumbers: number;
  /** Average length of the calls that connected. Zero when none did. */
  avgTalkTimeSec: number;
}

export function metricsFor(rows: CallRow[]): CallMetrics {
  const connected = rows.filter((r) => didConnect(r.direction, r.durationSec));
  const talkTimeSec = connected.reduce((n, r) => n + r.durationSec, 0);

  return {
    total: rows.length,
    outgoing: rows.filter((r) => r.direction === 'outgoing').length,
    incoming: rows.filter((r) => r.direction === 'incoming').length,
    notConnected: rows.filter((r) =>
      r.direction === 'missed' || r.direction === 'rejected' || r.direction === 'blocked').length,
    connectedOutgoing: connected.filter((r) => r.direction === 'outgoing').length,
    talkTimeSec,
    uniqueNumbers: new Set(rows.map((r) => r.e164Number)).size,
    crmNumbers: new Set(rows.filter((r) => r.matchedCrm).map((r) => r.e164Number)).size,
    avgTalkTimeSec: connected.length > 0 ? Math.round(talkTimeSec / connected.length) : 0,
  };
}

/**
 * Numbers that were called and never reached.
 *
 * The list a manager acts on. A number counts as unreached when **every** call
 * to it failed to connect - one successful conversation takes it off the list,
 * whatever happened before or after.
 */
export function neverConnected(rows: CallRow[]): { e164Number: string; attempts: number; lastAttempt: Date }[] {
  const byNumber = new Map<string, CallRow[]>();
  for (const r of rows) {
    byNumber.set(r.e164Number, [...(byNumber.get(r.e164Number) ?? []), r]);
  }

  const out: { e164Number: string; attempts: number; lastAttempt: Date }[] = [];
  for (const [e164Number, calls] of byNumber) {
    if (calls.some((c) => didConnect(c.direction, c.durationSec))) continue;
    out.push({
      e164Number,
      attempts: calls.length,
      lastAttempt: calls.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)).startedAt,
    });
  }

  return out.sort((a, b) => b.attempts - a.attempts
    || b.lastAttempt.getTime() - a.lastAttempt.getTime());
}

/** `1h 04m`, `3m 12s`, `45s`. Compact enough for a table cell. */
export function formatDuration(sec: number): string {
  if (sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// --------------------------------------------------------------- staleness

export type Staleness = 'never' | 'live' | 'lagging' | 'stale' | 'dead';

export interface StalenessResult {
  state: Staleness;
  hoursAgo: number | null;
  label: string;
  /** True when the manager should be told, loudly, before reading any count. */
  warn: boolean;
}

/**
 * How much to trust a phone's numbers.
 *
 * The thresholds are deliberately tight. A sales phone that has not reported in
 * six hours has almost certainly been killed by the OS, not gone quiet - people
 * do not stop using their phone for six hours during a working day. Waiting a
 * full day to raise it means a manager has already had a full day of wrong
 * numbers and drawn conclusions from them.
 */
export function staleness(lastSyncedAt: Date | null, now = new Date()): StalenessResult {
  if (!lastSyncedAt) {
    return {
      state: 'never',
      hoursAgo: null,
      label: 'Never reported',
      warn: true,
    };
  }

  const hoursAgo = (now.getTime() - lastSyncedAt.getTime()) / 3_600_000;

  if (hoursAgo < 2) return { state: 'live', hoursAgo, label: 'Reporting', warn: false };
  if (hoursAgo < 6) {
    return { state: 'lagging', hoursAgo, label: `Last reported ${Math.round(hoursAgo)}h ago`, warn: false };
  }
  if (hoursAgo < 48) {
    return {
      state: 'stale',
      hoursAgo,
      label: `No report for ${Math.round(hoursAgo)}h`,
      warn: true,
    };
  }

  const days = Math.floor(hoursAgo / 24);
  return {
    state: 'dead',
    hoursAgo,
    label: `No report for ${days} day${days === 1 ? '' : 's'}`,
    warn: true,
  };
}

/**
 * The sentence to put above a set of call figures when a phone has gone quiet.
 *
 * Written out here rather than in a component so it says the same thing on
 * every screen - and because the wording is the point. It must name the phone
 * as the problem, not the person.
 */
export function stalenessWarning(devices: { userName: string; lastSyncedAt: Date | null }[], now = new Date()): string | null {
  const bad = devices
    .map((d) => ({ ...d, s: staleness(d.lastSyncedAt, now) }))
    .filter((d) => d.s.warn);

  if (bad.length === 0) return null;

  const names = bad.map((d) => d.userName);
  const who = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `${who}${names.length === 1 ? '’s phone has' : '’s phones have'} stopped reporting. `
    + 'Their call figures below are incomplete - this is the app being shut down by the '
    + 'phone, not an absence of calls.';
}
