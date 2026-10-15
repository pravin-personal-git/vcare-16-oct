import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { API_BASE } from './api';
import { forgetDevice, loadDevice } from './device';

/**
 * Clock in and out - works without a signal.
 *
 * A punch is taken on the spot (time + precise location) and put in a small
 * queue on the phone. The queue is sent straight away, and again whenever
 * the app opens or the tracking service runs, until the server has it. The
 * server keeps the phone's own time for a queued punch (up to a day old, see
 * atlas-app lib/attendance-rule), so a clock-in made in a basement at 9:02
 * still reads 9:02.
 *
 * The screen shows the server's view of today, with any queued punch laid
 * over it, so the button never flips back while a punch is waiting.
 *
 * THE PHOTO (F2.5, decision D14). Where the owner has switched selfies on, a
 * punch carries one picture from the front camera. It is NOT a face scan -
 * nothing is enrolled, nothing is matched, and no template exists anywhere in
 * this feature. The picture rides with the punch through the offline queue,
 * stamped with the same time and fix, because a photo that only works with a
 * signal proves nothing about the basement.
 */

export interface Fix { lat: number; lng: number; accuracyM: number | null }

export interface Today {
  workDate: string;
  status: 'not_marked' | 'in_progress' | 'completed';
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number | null;
  openSince: string | null;
  rule: { allow: string; outside: string };
}

interface Punch {
  id: string; action: 'in' | 'out'; fix: Fix | null; mocked: boolean; clientTime: number;
  /** A photo is waiting under `photoKey(id)`. The picture itself is never kept here. */
  hasPhoto?: boolean;
}

const QUEUE = 'maalik.attendance.queue.v1';
const TODAY = 'maalik.attendance.today.v1';
const NOTICE = 'maalik.attendance.notice.v1';

/**
 * Each photo gets its own row rather than living on the punch.
 *
 * The queue is read and rewritten on every punch and every flush; a few
 * hundred kilobytes of base64 inside it would be parsed and re-serialised
 * each time. A separate key is also deleted independently, so a punch the
 * server accepted stops carrying a photograph of somebody's face around on
 * the phone a moment later.
 */
const PHOTO_PREFIX = 'maalik.attendance.photo.';
const photoKey = (id: string) => `${PHOTO_PREFIX}${id}`;

/**
 * A photo bigger than this is dropped and the punch sent alone.
 *
 * The server refuses anything over 3 MB, and a punch that can never be
 * accepted would block every punch behind it in the queue forever. Losing the
 * picture is the lesser failure - the same call the server makes when storage
 * is down (server/attendance-capture/selfie.ts).
 */
const MAX_PHOTO_CHARS = 1_600_000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
const writeJson = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined);

export const pendingPunches = () => readJson<Punch[]>(QUEUE, []);
export const cachedToday = () => readJson<Today | null>(TODAY, null);

/** A message from a queued punch the server refused (outside the allowed places). Read once. */
export async function takeNotice(): Promise<string | null> {
  const n = await readJson<string | null>(NOTICE, null);
  if (n) await AsyncStorage.removeItem(NOTICE).catch(() => undefined);
  return n;
}

/** The best fix available within ~15 s: a fresh precise one, else the last known. */
export async function currentFix(): Promise<{ fix: Fix | null; mocked: boolean }> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return { fix: null, mocked: false };
    // High accuracy can be refused ("No thanks" on Android's Location Accuracy
    // prompt) - that used to leave NO reading at all, so the technician could
    // never mark Working on site (emulator run, 28 Sep 2026). Fall back to
    // normal accuracy, then the last known position; the server still checks
    // the distance and the reported accuracy.
    const attempt = (accuracy: Location.Accuracy) => Promise.race([
      Location.getCurrentPositionAsync({ accuracy }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    const loc = await attempt(Location.Accuracy.High)
      ?? await attempt(Location.Accuracy.Balanced)
      ?? await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    if (!loc) return { fix: null, mocked: false };
    return {
      fix: { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracyM: loc.coords.accuracy ?? null },
      mocked: loc.mocked === true,
    };
  } catch {
    return { fix: null, mocked: false };
  }
}

type Sent = { ok: true; today: Today } | { ok: false; blocked?: string; unpaired?: boolean; offline?: boolean; error?: string };

async function send(token: string, p: Punch): Promise<Sent> {
  try {
    let photo: string | null = null;
    if (p.hasPhoto) {
      photo = await AsyncStorage.getItem(photoKey(p.id)).catch(() => null);
      if (photo && photo.length > MAX_PHOTO_CHARS) photo = null;
    }
    const res = await fetch(`${API_BASE}/api/v1/attendance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': token },
      body: JSON.stringify({
        action: p.action, fix: p.fix, mocked: p.mocked, clientTime: p.clientTime,
        ...(photo ? { photo, photoType: 'image/jpeg' } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { today?: Today; error?: string; blocked?: boolean };
    if (res.ok && json.today) return { ok: true, today: json.today };
    if (res.status === 401) return { ok: false, unpaired: true };
    if (res.status === 422 && json.blocked) return { ok: false, blocked: json.error ?? 'Outside the allowed places.' };
    // 409: already clocked in/out - the server's view wins; drop the punch.
    if (res.status === 409 || res.status === 400) return { ok: false, error: json.error ?? 'Not accepted.' };
    return { ok: false, offline: true };
  } catch {
    return { ok: false, offline: true };
  }
}

const dropPhoto = (id: string) => AsyncStorage.removeItem(photoKey(id)).catch(() => undefined);

/**
 * Photos whose punch is no longer in the queue.
 *
 * Nothing should leave one behind, but "should" is not a guarantee: the app can
 * be killed between writing the picture and writing the queue. A face left in
 * storage for good is the sort of thing that only turns up in a privacy review,
 * so it is swept on every flush.
 */
async function sweepPhotos(queue: Punch[]): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const alive = new Set(queue.map((q) => photoKey(q.id)));
    // A punch id begins with the epoch millisecond it was made at. Only sweep
    // photos older than a few minutes: `punch` writes the picture before it
    // writes the queue entry, and a flush running in the background at that
    // exact moment must not carry off a photo that is about to be claimed.
    const cutoff = Date.now() - 5 * 60_000;
    const dead = keys.filter((k) => {
      if (!k.startsWith(PHOTO_PREFIX) || alive.has(k)) return false;
      const made = Number(k.slice(PHOTO_PREFIX.length).split('-')[0]);
      return !Number.isFinite(made) || made < cutoff;
    });
    if (dead.length) await AsyncStorage.multiRemove(dead);
  } catch {
    // Housekeeping. It can wait for the next flush.
  }
}

let flushing: Promise<Today | null> | null = null;

/** Send every queued punch, oldest first. Stops at the first one that cannot get through. */
export function flushPunches(): Promise<Today | null> {
  flushing ??= (async () => {
    try {
      const device = await loadDevice();
      if (!device) return null;
      let queue = await pendingPunches();
      let today: Today | null = null;
      while (queue.length) {
        const r = await send(device.token, queue[0]);
        if (!r.ok && r.offline) break;
        if (!r.ok && r.unpaired) { await forgetDevice(); break; }
        if (!r.ok && r.blocked) await writeJson(NOTICE, r.blocked);
        if (r.ok) today = r.today;
        // Sent, or refused for good - either way the picture has no second use.
        await dropPhoto(queue[0].id);
        queue = queue.slice(1);
        await writeJson(QUEUE, queue);
      }
      if (today) await writeJson(TODAY, today);
      await sweepPhotos(queue);
      return today;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Fetch the server's view of today (after sending anything queued). Falls back to the cached one offline. */
export async function loadToday(): Promise<{ today: Today | null; pending: Punch[]; offline: boolean }> {
  await flushPunches();
  const device = await loadDevice();
  const pending = await pendingPunches();
  if (!device) return { today: null, pending, offline: false };
  try {
    const res = await fetch(`${API_BASE}/api/v1/attendance`, { headers: { 'x-device-token': device.token } });
    if (res.status === 401) { await forgetDevice(); return { today: null, pending, offline: false }; }
    if (!res.ok) throw new Error('offline');
    const today = (await res.json()) as Today;
    await writeJson(TODAY, today);
    return { today, pending, offline: false };
  } catch {
    return { today: await cachedToday(), pending, offline: true };
  }
}

export type PunchOutcome =
  | { kind: 'done'; today: Today }
  | { kind: 'queued' }
  | { kind: 'blocked'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'unpaired' };

/**
 * Clock in or out now. Online: the answer comes back at once. Offline: queued.
 *
 * `photoBase64` is the front-camera picture, where the owner asks for one. It
 * is written to storage BEFORE the punch is attempted, so a punch that ends up
 * queued still has its photo after the app is killed - and an oversized one is
 * dropped here rather than being queued to fail forever against the server's
 * 3 MB limit. A photo never decides whether the punch happens.
 */
export async function punch(action: 'in' | 'out', photoBase64?: string | null): Promise<PunchOutcome> {
  const device = await loadDevice();
  if (!device) return { kind: 'unpaired' };
  const { fix, mocked } = await currentFix();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const photo = photoBase64 && photoBase64.length <= MAX_PHOTO_CHARS ? photoBase64 : null;
  if (photo) await AsyncStorage.setItem(photoKey(id), photo).catch(() => undefined);
  const p: Punch = { id, action, fix, mocked, clientTime: Date.now(), hasPhoto: photo != null };

  // Anything older goes first, so the order on the server is the order they happened.
  if ((await pendingPunches()).length) {
    await writeJson(QUEUE, [...(await pendingPunches()), p]);
    await flushPunches();
    return (await pendingPunches()).some((q) => q.id === p.id) ? { kind: 'queued' } : { kind: 'done', today: (await cachedToday())! };
  }

  const r = await send(device.token, p);
  if (r.ok) { await dropPhoto(id); await writeJson(TODAY, r.today); return { kind: 'done', today: r.today }; }
  if (r.unpaired) { await dropPhoto(id); await forgetDevice(); return { kind: 'unpaired' }; }
  if (r.blocked) { await dropPhoto(id); return { kind: 'blocked', message: r.blocked }; }
  if (r.error) { await dropPhoto(id); return { kind: 'refused', message: r.error }; }
  await writeJson(QUEUE, [...(await pendingPunches()), p]);
  return { kind: 'queued' };
}

/** Whether a shift is running, from the server's view plus anything still queued. */
export function onShift(today: Today | null, pending: Punch[]): boolean {
  const last = pending[pending.length - 1];
  if (last) return last.action === 'in';
  return today?.status === 'in_progress';
}
