import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { CallLogModule } from '../../modules/call-log';
import { API_BASE } from './api';
import { loadDevice } from './device';

/**
 * Sending the call log - numbers, times and durations only, never audio.
 *
 * The server says which call it last received (`lastCallAt`); the phone
 * sends everything after it in batches of 200. The branch's capture setting
 * ("CRM numbers only" or "all calls") is applied on the server, so a number
 * that is not a customer or lead is dropped there, not here. First sync
 * looks back 7 days at most.
 *
 * 27 Sep 2026 (Deepak's phone checked in for hours and never sent a call):
 * - every request has a time limit - React Native's fetch has none, so one
 *   stalled request kept `running` set and blocked every later sync until
 *   the app was force-stopped;
 * - the permission gate uses the same Android check the setup screen and
 *   check-ins report, not a second native check that could disagree;
 * - each attempt's outcome is kept and reported with the next check-in, so
 *   the Phones page says exactly where it stopped.
 */

const LAST_SYNC = 'maalik.calls.lastSync.v1';
const STATUS = 'maalik.calls.status.v1';
const FIRST_LOOKBACK_MS = 7 * 24 * 3_600_000;
const BATCH = 200;
const REQUEST_MS = 20_000;
/** A sync still "running" after this long is treated as dead, not waited for. */
const STALE_MS = 3 * 60_000;

/** Where the last attempt got to - sent to the server with each check-in. */
export interface CallSyncStatus {
  at: number;
  stage: 'no_module' | 'no_permission' | 'not_paired' | 'server' | 'read_failed' | 'upload_failed' | 'ok';
  sent?: number;
  error?: string;
}

let running: Promise<number> | null = null;
let startedAt = 0;

export const callLogAvailable = () => Platform.OS === 'android' && !!CallLogModule;

export async function lastCallSync(): Promise<number | null> {
  const v = await AsyncStorage.getItem(LAST_SYNC).catch(() => null);
  return v ? Number(v) : null;
}

export async function callSyncStatus(): Promise<CallSyncStatus | null> {
  const v = await AsyncStorage.getItem(STATUS).catch(() => null);
  try { return v ? (JSON.parse(v) as CallSyncStatus) : null; } catch { return null; }
}

async function note(s: Omit<CallSyncStatus, 'at'>): Promise<void> {
  await AsyncStorage.setItem(STATUS, JSON.stringify({ ...s, at: Date.now() })).catch(() => undefined);
}

/** fetch with a time limit. */
async function timed(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_MS);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Sync what is new. Returns how many calls were sent; never throws. */
export function syncCalls(): Promise<number> {
  if (running && Date.now() - startedAt > STALE_MS) running = null;
  if (running) return running;
  startedAt = Date.now();
  running = (async () => {
    try {
      if (Platform.OS !== 'android') return 0;
      if (!CallLogModule) { await note({ stage: 'no_module' }); return 0; }
      const allowed = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG).catch(() => false);
      if (!allowed) { await note({ stage: 'no_permission' }); return 0; }
      const device = await loadDevice();
      if (!device) { await note({ stage: 'not_paired' }); return 0; }
      const headers = { 'content-type': 'application/json', 'x-device-token': device.token };

      let state: Response;
      try { state = await timed(`${API_BASE}/api/v1/calls`, { headers }); } catch (e) { await note({ stage: 'server', error: message(e) }); return 0; }
      if (!state.ok) { await note({ stage: 'server', error: `HTTP ${state.status}` }); return 0; }
      const { lastCallAt, enabled } = (await state.json()) as { lastCallAt: string | null; enabled?: boolean };
      // Switched off for this person (Settings > Roles > Phone app): read nothing.
      if (enabled === false) { await note({ stage: 'ok', sent: 0, error: 'switched off for this person' }); return 0; }
      let since = Math.max(lastCallAt ? Date.parse(lastCallAt) : 0, Date.now() - FIRST_LOOKBACK_MS);

      let sent = 0;
      for (let round = 0; round < 10; round++) {
        let calls;
        try { calls = await CallLogModule.getCalls(since, BATCH); } catch (e) { await note({ stage: 'read_failed', sent, error: message(e) }); return sent; }
        if (!calls.length) break;
        let res: Response;
        try {
          res = await timed(`${API_BASE}/api/v1/calls`, { method: 'POST', headers, body: JSON.stringify({ calls }) });
        } catch (e) { await note({ stage: 'upload_failed', sent, error: message(e) }); return sent; }
        if (!res.ok) { await note({ stage: 'upload_failed', sent, error: `HTTP ${res.status}` }); return sent; }
        sent += calls.length;
        since = calls[calls.length - 1].startedAtMs;
        if (calls.length < BATCH) break;
      }
      await AsyncStorage.setItem(LAST_SYNC, String(Date.now())).catch(() => undefined);
      await note({ stage: 'ok', sent });
      return sent;
    } catch (e) {
      await note({ stage: 'upload_failed', error: message(e) });
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}
