import { NextResponse } from 'next/server';

/**
 * The newest Vcare build, for the app's "update available" check.
 *
 * Set on the server (Vercel env) when a new APK is shared, until the app is
 * on the Play Store and Play handles updates:
 *   MAALIK_APP_VERSION_CODE  e.g. 2  (android versionCode of the newest APK)
 *   MAALIK_APP_VERSION       e.g. 1.1.0
 *   MAALIK_APP_URL           where the APK can be downloaded
 *   MAALIK_APP_MIN_CODE      builds below this must update to keep working
 *   MAALIK_APP_NOTES         one line on what changed
 * Unset = nothing newer is announced. Public: no account data in here.
 */
export function GET() {
  const code = Number(process.env.MAALIK_APP_VERSION_CODE ?? 0);
  return NextResponse.json({
    versionCode: Number.isFinite(code) ? code : 0,
    version: process.env.MAALIK_APP_VERSION ?? null,
    url: process.env.MAALIK_APP_URL ?? null,
    minVersionCode: Number(process.env.MAALIK_APP_MIN_CODE ?? 0) || 0,
    notes: process.env.MAALIK_APP_NOTES ?? null,
  }, { headers: { 'cache-control': 'public, max-age=300' } });
}
