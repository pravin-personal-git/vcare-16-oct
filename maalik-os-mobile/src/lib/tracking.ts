import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { API_BASE } from './api';
import { loadDevice } from './device';
import { flushPunches } from './attendance';
import { checkIn } from './checkin';
import { syncCalls } from './calls';
import { flushJobQueue } from './jobQueue';

/**
 * Where the phone is during a shift - and only during a shift.
 *
 * Agreed in the roadmap: a position every 2 minutes while moving, every 10
 * while still, with Android's own "Vcare is using your location"
 * notification showing the whole time. Android wakes the task about every
 * 2 minutes; the task keeps a point if the phone moved 30 m or more, or if 10
 * minutes have passed since the last kept one. Points wait on the phone and
 * are sent in batches, so a dead zone loses nothing.
 */

export const TRACK_TASK = 'maalik-os.track';
const BUFFER = 'maalik.track.buffer.v1';
const LAST = 'maalik.track.last.v1';

const MOVE_M = 30;
const STILL_MS = 10 * 60_000;
const MAX_BUFFER = 2000;

interface Point { lat: number; lng: number; accuracyM: number | null; at: number; mocked: boolean; speedMps: number | null }

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

/** Keep the points worth keeping from what Android delivered. */
async function collect(locations: Location.LocationObject[]): Promise<void> {
  let last = await readJson<Point | null>(LAST, null);
  const buffer = await readJson<Point[]>(BUFFER, []);
  for (const l of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    const p: Point = {
      lat: l.coords.latitude, lng: l.coords.longitude, accuracyM: l.coords.accuracy ?? null,
      at: l.timestamp, mocked: l.mocked === true,
      speedMps: typeof l.coords.speed === 'number' && l.coords.speed >= 0 ? l.coords.speed : null,
    };
    if (p.accuracyM !== null && p.accuracyM > 500) continue; // no fix worth drawing
    if (last && !p.mocked && metres(last, p) < MOVE_M && p.at - last.at < STILL_MS) continue;
    buffer.push(p);
    last = p;
  }
  await AsyncStorage.multiSet([
    [BUFFER, JSON.stringify(buffer.slice(-MAX_BUFFER))],
    [LAST, JSON.stringify(last)],
  ]).catch(() => undefined);
}

/** Send what is waiting. Leaves it in place if the send fails. */
export async function flushTrack(): Promise<void> {
  const device = await loadDevice();
  if (!device) return;
  const buffer = await readJson<Point[]>(BUFFER, []);
  if (!buffer.length) return;
  const batch = buffer.slice(0, 400);
  try {
    const res = await fetch(`${API_BASE}/api/v1/attendance/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': device.token },
      body: JSON.stringify({ points: batch }),
    });
    if (!res.ok) return;
    const rest = (await readJson<Point[]>(BUFFER, [])).filter((p) => p.at > batch[batch.length - 1].at);
    await AsyncStorage.setItem(BUFFER, JSON.stringify(rest)).catch(() => undefined);
  } catch { /* offline - next run */ }
}

let lastCheckIn = 0;

if (Platform.OS === 'android') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRACK_TASK, async ({ data, error }) => {
    if (error || !data) return;
    await collect(data.locations ?? []);
    await flushPunches();
    await flushTrack();
    // The shift keeps the phone "reporting" on the website too.
    if (Date.now() - lastCheckIn > 5 * 60_000) { lastCheckIn = Date.now(); await checkIn(true); await flushJobQueue(); await syncCalls(); }
  });
}

/** Start the shift's location service (idempotent). Returns false when permission is missing. */
export async function startTracking(t: (s: string) => string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return false;
    if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK)) return true;
    await Location.startLocationUpdatesAsync(TRACK_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 2 * 60_000,
      distanceInterval: 0,
      deferredUpdatesInterval: 2 * 60_000,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: t('Vcare - on shift'),
        notificationBody: t('Your location is shared with your employer until you clock out.'),
        notificationColor: '#1F43C2',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Stop it at clock-out, and send what is left. */
export async function stopTracking(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK)) await Location.stopLocationUpdatesAsync(TRACK_TASK);
  } catch { /* already stopped */ }
  await AsyncStorage.removeItem(LAST).catch(() => undefined);
  await flushTrack();
}

export async function isTracking(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try { return await Location.hasStartedLocationUpdatesAsync(TRACK_TASK); } catch { return false; }
}
