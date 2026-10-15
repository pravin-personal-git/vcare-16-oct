/**
 * The rules behind "can this phone be trusted" - Vcare roadmap §6.
 *
 * Pure functions, so every rule is tested and the web Phones screen, the
 * status watcher and the check-in route all apply exactly the same ones.
 * Nothing here is silent: every rule produces a status or an event that the
 * admin sees, never a quietly dropped record.
 */

export const DEVICE_EVENT_KINDS = [
  'paired',            // a code was redeemed on this phone
  'replaced',          // the employee paired a new phone; this one was switched off
  'revoked',           // an admin switched it off
  'not_reporting',     // missed its check-ins
  'reporting_again',   // came back after not reporting
  'app_removed',       // Google says the app is no longer on the phone
  'location_off',      // location permission or GPS switched off
  'permission_removed',// call log / notifications / background location taken away
  'battery_restricted',// the phone's battery saver may stop tracking
  'mock_location',     // a location arrived flagged as fake
  'clock_changed',     // phone time far from server time
  'device_changed',    // a different ANDROID_ID - reset or another phone
  'integrity_failed',  // rooted / tampered / modified app
] as const;
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number];

/** Silence allowed before a phone counts as not reporting. */
export const QUIET_ON_SHIFT_MS = 15 * 60_000;
export const QUIET_OFF_SHIFT_MS = 12 * 60 * 60_000;

/** Phone clock this far from the server clock is flagged. */
export const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

export type DeviceStatus = 'revoked' | 'app_removed' | 'never_reported' | 'not_reporting' | 'active';

export function deviceStatus(
  d: { isActive: boolean; appRemovedAt: Date | null; lastSyncedAt: Date | null; pairedAt: Date },
  onShift: boolean,
  now: Date = new Date(),
): DeviceStatus {
  if (!d.isActive) return 'revoked';
  if (d.appRemovedAt && (!d.lastSyncedAt || d.appRemovedAt > d.lastSyncedAt)) return 'app_removed';
  const quiet = onShift ? QUIET_ON_SHIFT_MS : QUIET_OFF_SHIFT_MS;
  if (!d.lastSyncedAt) return now.getTime() - d.pairedAt.getTime() > quiet ? 'not_reporting' : 'never_reported';
  return now.getTime() - d.lastSyncedAt.getTime() > quiet ? 'not_reporting' : 'active';
}

export function clockSkewed(skewMs: number | null | undefined): boolean {
  return skewMs !== null && skewMs !== undefined && Math.abs(skewMs) > CLOCK_SKEW_LIMIT_MS;
}

/** A different ANDROID_ID than the one paired means a reset or a different phone. */
export function deviceChanged(paired: string | null, reported: string | null | undefined): boolean {
  return !!paired && !!reported && paired !== reported;
}

/** What the phone reports about itself on every check-in. */
export interface PermissionState {
  /** 'always' = background location allowed, 'foreground' = only while open. */
  location: 'always' | 'foreground' | 'denied';
  /** Device location (GPS) switched on at all. */
  locationServices: boolean;
  callLog: boolean;
  notifications: boolean;
  /** Battery saver will not kill the app. */
  batteryUnrestricted: boolean;
}

/**
 * Turn a change in the phone's report into events. Only transitions count -
 * a phone that has had location off all day produces one event, not one per
 * check-in.
 */
export function permissionEvents(prev: PermissionState | null, next: PermissionState): DeviceEventKind[] {
  const out: DeviceEventKind[] = [];
  // "Was fine before (or this is the first report) and is not fine now."
  const lost = (was: boolean | undefined, now: boolean) => (was ?? true) && !now;
  const locationOk = (s: PermissionState) => s.location === 'always' && s.locationServices;
  if (lost(prev ? locationOk(prev) : undefined, locationOk(next))) out.push('location_off');
  if (lost(prev?.callLog, next.callLog) || lost(prev?.notifications, next.notifications)) out.push('permission_removed');
  if (lost(prev?.batteryUnrestricted, next.batteryUnrestricted)) out.push('battery_restricted');
  return out;
}

/** Read what the phone sent, trusting only the known fields and shapes. */
export function parsePermissionState(v: unknown): PermissionState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const location = o.location === 'always' || o.location === 'foreground' ? o.location : 'denied';
  return {
    location,
    locationServices: o.locationServices === true,
    callLog: o.callLog === true,
    notifications: o.notifications === true,
    batteryUnrestricted: o.batteryUnrestricted === true,
  };
}

/** Who may create pairing codes: the new "Pair phones" permission, or the older device-management one. */
export function canPairPhones(permissions: { has(p: string): boolean }): boolean {
  return permissions.has('devices.pair') || permissions.has('calls.manage');
}

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  active: 'Active',
  never_reported: 'Waiting for first check-in',
  not_reporting: 'Not reporting',
  app_removed: 'App removed',
  revoked: 'Switched off',
};

export interface CallHealth { tone: 'ok' | 'warn' | 'bad'; text: string }

export interface CallSyncState {
  at: number;
  stage: 'no_module' | 'no_permission' | 'not_paired' | 'server' | 'read_failed' | 'upload_failed' | 'ok';
  sent?: number;
  error?: string;
}

const SYNC_STAGES = ['no_module', 'no_permission', 'not_paired', 'server', 'read_failed', 'upload_failed', 'ok'];

/** Read the phone's call-sync report, trusting only the known fields. */
export function parseCallSyncState(v: unknown): CallSyncState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'number' || typeof o.stage !== 'string' || !SYNC_STAGES.includes(o.stage)) return null;
  return {
    at: o.at, stage: o.stage as CallSyncState['stage'],
    ...(typeof o.sent === 'number' ? { sent: o.sent } : {}),
    ...(typeof o.error === 'string' ? { error: o.error.slice(0, 200) } : {}),
  };
}

const PHONE_SAYS: Record<Exclude<CallSyncState['stage'], 'ok'>, string> = {
  no_module: 'This app build cannot read calls - install the latest Vcare.',
  no_permission: 'The phone says call-log permission is not allowed. Android Settings > Apps > Vcare > Permissions > Call logs = Allow (if greyed out: app info > ⋮ > Allow restricted settings).',
  not_paired: 'The app on the phone is not paired any more - pair it again.',
  server: 'The phone could not reach Atlas to send calls',
  read_failed: 'The phone could not read its call log',
  upload_failed: 'The phone could not upload its calls',
};

/**
 * Why a phone does or does not show calls, in one plain sentence (27 Sep
 * 2026, streamline S4). Deepak's phone was "Active" with 0 calls and nothing
 * on screen could say why; these are the five reasons it can be, checked in
 * the order a person would fix them.
 */
export function callHealth(d: {
  isActive: boolean;
  trackingOn: boolean;
  permission: PermissionState | null;
  lastSyncedAt: Date | null;
  /** When the app last asked to send calls (GET /api/v1/calls). */
  lastCallCheckAt?: Date | null;
  lastCallSyncError?: string | null;
  /** What the phone itself reported about its last call sync (1.0.4+). */
  phoneReport?: CallSyncState | null;
  lastSyncAccepted: number | null;
  lastSyncSkipped: number | null;
  captureMode: string;
  storeName: string;
}, when: (d: Date) => string): CallHealth {
  if (!d.isActive) return { tone: 'bad', text: 'Revoked - this phone no longer sends anything.' };
  if (!d.trackingOn) return { tone: 'bad', text: 'Call reading is switched off for this person (Settings > Roles > Phone app).' };
  if (d.permission && !d.permission.callLog) return { tone: 'bad', text: 'Call-log permission is not allowed on the phone. Open Vcare > Phone setup > Allow call log.' };
  if (d.lastCallSyncError) return { tone: 'bad', text: `The last call upload failed: ${d.lastCallSyncError}` };
  // The phone's own report is the most specific answer when it has one.
  if (d.phoneReport && d.phoneReport.stage !== 'ok') {
    const base = PHONE_SAYS[d.phoneReport.stage];
    return { tone: 'bad', text: `${base}${d.phoneReport.error ? ` (${d.phoneReport.error})` : ''} - ${when(new Date(d.phoneReport.at))}.` };
  }
  if (!d.lastSyncedAt) return { tone: 'warn', text: 'Has not sent its call list yet - it does when the app opens, at clock-in/out and every few minutes on shift.' };
  // Checking in but never asking to send calls: the app cannot read the call
  // log (permission revoked in Android settings, or restricted), whatever it
  // reported at setup. Recorded from 27 Sep 2026.
  if (d.lastCallCheckAt === null) {
    return { tone: 'warn', text: 'Checks in, but has not tried to send calls since 27 Sep. Open Vcare on the phone once; if this stays, check Android Settings > Apps > Vcare > Permissions > Call logs = Allow.' };
  }
  const checked = d.lastCallCheckAt ?? d.lastSyncedAt;
  // Asked, but nothing new to send since the counts were recorded: say when, not a made-up 0.
  if (d.lastSyncAccepted === null && d.lastSyncSkipped === null) return { tone: 'ok', text: `Call list checked ${when(checked)} - no new calls to send.` };
  const skipped = d.lastSyncSkipped ?? 0;
  const kept = d.lastSyncAccepted ?? 0;
  if (skipped > 0 && kept === 0 && d.captureMode === 'crm_only') {
    return { tone: 'warn', text: `Last call upload ${when(checked)}: ${skipped} call(s) left out - the numbers are not customers of ${d.storeName}, and this branch collects only calls to people in the CRM.` };
  }
  return { tone: 'ok', text: `Last call upload ${when(checked)}: ${kept} new call(s)${skipped ? `, ${skipped} left out (not in the CRM)` : ''}.` };
}
