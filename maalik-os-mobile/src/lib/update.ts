import * as Application from 'expo-application';
import { API_BASE } from './api';

/**
 * "Is there a newer Vcare?" - asked when the app opens. While the app
 * is shared as an APK (before Play Store), the server says which build is
 * newest and where to get it (atlas-app /api/v1/app/version).
 */
export interface UpdateInfo { version: string | null; url: string; notes: string | null; required: boolean }

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const mine = Number(Application.nativeBuildVersion ?? 0);
  if (!mine) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/app/version`);
    if (!res.ok) return null;
    const v = (await res.json()) as { versionCode: number; version: string | null; url: string | null; minVersionCode: number; notes: string | null };
    if (!v.url || !(v.versionCode > mine)) return null;
    return { version: v.version, url: v.url, notes: v.notes, required: mine < v.minVersionCode };
  } catch {
    return null;
  }
}
