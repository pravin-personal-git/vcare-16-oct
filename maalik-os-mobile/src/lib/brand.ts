import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The business's own colours (UI refresh phase 5, 4 Oct 2026).
 *
 * The website's Settings › Appearance sets them; the server sends them with
 * "who am I" (staff) and the customer home. They are kept on the phone so the
 * next start opens in the right colours before any network call, and cleared
 * on sign-out so the next person does not see the last business's colours.
 */
export interface Brand { primary: string | null; navy: string | null }

const KEY = 'maalik.brand';
const HEX = /^#[0-9a-f]{6}$/i;
const listeners = new Set<(b: Brand | null) => void>();

function clean(b: unknown): Brand | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : null);
  const out = { primary: pick(o.primary), navy: pick(o.navy) };
  return out.primary || out.navy ? out : null;
}

export async function loadBrand(): Promise<Brand | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Remember what the server said. `undefined` (an older server) changes nothing. */
export function rememberBrand(b: unknown): void {
  if (b === undefined) return;
  const next = clean(b);
  void (next ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : AsyncStorage.removeItem(KEY)).catch(() => undefined);
  for (const fn of listeners) fn(next);
}

export function onBrand(fn: (b: Brand | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
