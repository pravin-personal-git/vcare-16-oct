import { useSyncExternalStore } from 'react';

/**
 * Large text (13 Oct 2026, decision 7): the simple field-worker layout reads
 * at a bigger size by default - in the sun, on a 6" phone, for people who do
 * not read small English all day. One multiplier for every <Text>, set from
 * the person's layout (Settings > Roles > Phone app > Layout) when the app
 * learns it. 1 = the sizes the app always had.
 */
let scale = 1;
const listeners = new Set<() => void>();

export function setTextScale(next: number) {
  if (next === scale) return;
  scale = next;
  listeners.forEach((l) => l());
}

export const LARGE_TEXT = 1.15;

export function useTextScale(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => scale,
    () => scale,
  );
}
