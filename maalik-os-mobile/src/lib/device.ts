import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { API_BASE, ApiError } from './api';

/**
 * This phone's own identity - separate from whoever is signed in.
 *
 * Pairing gives the PHONE a long-lived device token (it belongs to the
 * employee the admin chose, not to a login session). It is kept in encrypted
 * storage and sent as `x-device-token`: on login (an employee may sign in only
 * on their own paired phone) and on every check-in. Signing out does not
 * unpair the phone; only the admin, or pairing a new phone, does.
 */

const KEY = 'maalik.device.v1';

export interface PairedDevice {
  token: string;
  userId: string;
  userName: string;
  storeName: string;
  pairedAt: number;
}

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(KEY); } catch { return null; }
}

async function write(v: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try { if (v === null) globalThis.localStorage?.removeItem(KEY); else globalThis.localStorage?.setItem(KEY, v); } catch { /* preview only */ }
    return;
  }
  if (v === null) await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  else await SecureStore.setItemAsync(KEY, v);
}

export async function loadDevice(): Promise<PairedDevice | null> {
  const raw = await read();
  if (!raw) return null;
  try { return JSON.parse(raw) as PairedDevice; } catch { return null; }
}

export const forgetDevice = () => write(null);

/** ANDROID_ID (SSAID) - fraud prevention only, never advertising (roadmap §6.5). */
export function androidId(): string | null {
  if (Platform.OS !== 'android') return null;
  try { return Application.getAndroidId(); } catch { return null; }
}

/** Model and Android version from the platform itself - no extra permission needed. */
export function deviceInfo(): { deviceModel: string | null; androidVersion: string | null; appVersion: string | null } {
  const c = Platform.constants as { Model?: string; Manufacturer?: string; Release?: string | number };
  return {
    deviceModel: [c.Manufacturer, c.Model].filter(Boolean).join(' ') || null,
    androidVersion: c.Release != null ? String(c.Release) : null,
    appVersion: Application.nativeApplicationVersion ?? null,
  };
}

/** Exchange the admin's pairing code for this phone's device token. */
export async function pairPhone(code: string): Promise<PairedDevice> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase(), androidId: androidId(), ...deviceInfo() }),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check the connection and try again.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? 'Pairing failed. Try again.', res.status);
  const device: PairedDevice = {
    token: json.deviceToken,
    userId: json.userId,
    userName: json.userName,
    storeName: json.storeName,
    pairedAt: Date.now(),
  };
  await write(JSON.stringify(device));
  return device;
}
