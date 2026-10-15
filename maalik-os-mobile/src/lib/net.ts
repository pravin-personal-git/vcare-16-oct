import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * OFFLINE, PART 1 - THE LAST GOOD COPY (F-13, 13 Oct 2026, PHONE-OFFLINE-SPEC).
 *
 * Every answer the phone reads from the server (`authed` GET) is kept here,
 * per signed-in person. With no signal the same request is answered from the
 * kept copy instead of an error, and the app says so: "No signal - showing
 * 10:42". One place, so all 24 screens that load through `useLoad` work
 * offline without each of them being taught how.
 *
 * What is kept is exactly what the server sent this person - hidden prices
 * and phone numbers were already taken out on the server (lib/app-access
 * `redact`). Signing out wipes it.
 */
const PREFIX = 'maalik.cache.v1:';
const INDEX = 'maalik.cache.v1.index';
/** Enough for every job, installation and list a technician opens in a week. */
const MAX_ENTRIES = 400;

interface Entry<T> { at: number; data: T }

// ------------------------------------------------------------- online or not

interface NetState { offline: boolean; showingFrom: number | null }
let state: NetState = { offline: false, showingFrom: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function markOnline() {
  if (!state.offline && state.showingFrom === null) return;
  state = { offline: false, showingFrom: null };
  emit();
}

function markOffline(at: number | null) {
  const showingFrom = at === null ? state.showingFrom : Math.min(state.showingFrom ?? at, at);
  if (state.offline && state.showingFrom === showingFrom) return;
  state = { offline: true, showingFrom };
  emit();
}

/** No signal right now (the last call could not reach the server), and the oldest copy on screen. */
export function useNet(): NetState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}

export const isOfflineNow = () => state.offline;

// ------------------------------------------------------------- the copies

let index: { k: string; at: number }[] | null = null;
async function loadIndex() {
  if (index) return index;
  try { index = JSON.parse((await AsyncStorage.getItem(INDEX)) ?? '[]') as { k: string; at: number }[]; } catch { index = []; }
  return index;
}

const keyFor = (who: string, path: string) => `${PREFIX}${who}:${path}`;

export async function keepCopy(who: string, path: string, data: unknown) {
  const k = keyFor(who, path);
  const at = Date.now();
  try {
    await AsyncStorage.setItem(k, JSON.stringify({ at, data } satisfies Entry<unknown>));
    const idx = (await loadIndex()).filter((e) => e.k !== k);
    idx.push({ k, at });
    // The oldest go first when the phone holds too many.
    const drop = idx.length > MAX_ENTRIES ? idx.splice(0, idx.length - MAX_ENTRIES) : [];
    index = idx;
    if (drop.length) await AsyncStorage.multiRemove(drop.map((d) => d.k));
    await AsyncStorage.setItem(INDEX, JSON.stringify(idx));
  } catch {
    // Phone storage full or unavailable - the app still works online.
  }
}

/** The kept copy for this request, and the moment it was taken; marks the app offline. */
export async function lastCopy<T>(who: string, path: string): Promise<T | null> {
  try {
    const v = await AsyncStorage.getItem(keyFor(who, path));
    if (!v) { markOffline(null); return null; }
    const e = JSON.parse(v) as Entry<T>;
    markOffline(e.at);
    return e.data;
  } catch {
    markOffline(null);
    return null;
  }
}

/** Sign out: nothing of this person stays on the phone. */
export async function wipeCopies() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX) || k === INDEX);
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* nothing kept */ }
  index = [];
  state = { offline: false, showingFrom: null };
  emit();
}

/** Never reached the server (no signal, timeout) - as opposed to the server saying no. */
export function isNoSignal(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return !(e instanceof Error) || status === 0 || status === undefined;
}
