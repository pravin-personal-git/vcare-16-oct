import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Who is signed in on this phone, kept in encrypted storage.
 *
 * On a phone the tokens live in the Android Keystore through SecureStore -
 * never in plain AsyncStorage. The browser preview (used only while designing
 * screens) has no secure store, so there it falls back to localStorage; that
 * path never ships in the APK.
 */

export type SessionKind = 'user' | 'party';

export interface Session {
  kind: SessionKind;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working (a minute early, for clock drift). */
  accessExpiresAt: number;
  /** For a business user: where the server said they belong ('dashboard' | 'platform'). */
  destination?: string;
  /** For a business user: owner view or employee home (from /auth/me). */
  home?: 'owner' | 'employee';
  /** The store the phone is working in; sent as x-store-id on every call. */
  storeId?: string | null;
  stores?: { id: string; name: string; branchCode: string }[];
  /** For a business user: what the website allows them (decides which job tiles show). */
  permissions?: string[];
  /** For a business user: the owner's Phone app settings (lib/access). */
  app?: import('./access').AppAccess;
  /** For a customer: the business gave a temporary password that must be changed. */
  mustReset?: boolean;
  profile: { id: string; name: string; username?: string; phone?: string | null; email?: string | null };
}

const KEY = 'maalik.session.v1';

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(KEY); } catch { return null; }
}

async function write(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(KEY);
      else globalThis.localStorage?.setItem(KEY, value);
    } catch { /* preview only */ }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  else await SecureStore.setItemAsync(KEY, value);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await read();
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s && s.accessToken && s.refreshToken ? s : null;
  } catch {
    return null;
  }
}

export const saveSession = (s: Session) => write(JSON.stringify(s));
export const clearSession = () => write(null);

/** Token lifetimes come back in seconds; keep a minute in hand. */
export function expiryFrom(expiresInSeconds: number, now = Date.now()): number {
  return now + Math.max(0, expiresInSeconds - 60) * 1000;
}
