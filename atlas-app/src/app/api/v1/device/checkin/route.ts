import { NextResponse } from 'next/server';
import { CallLogError } from '@/server/call-logs';
import { checkInDevice } from '@/server/device-trust';

/**
 * The phone's regular check-in: "still here", its permission and battery
 * state, its clock and its ANDROID_ID. Silence between check-ins is what
 * turns a phone "Not reporting" on the website. Authenticated by the phone's
 * own device token (x-device-token), independent of who is signed in.
 */
export async function POST(req: Request) {
  const token = req.headers.get('x-device-token') ?? '';
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await checkInDevice(token, {
      androidId: typeof body.androidId === 'string' ? body.androidId : null,
      permissions: body.permissions,
      clientTime: typeof body.clientTime === 'number' ? body.clientTime : null,
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : null,
      onShift: body.onShift === true,
      callSync: body.callSync,
    }, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null);
    return NextResponse.json(r, { status: r.mustRepair ? 409 : 200 });
  } catch (err) {
    if (err instanceof CallLogError) return NextResponse.json({ error: err.message, mustRepair: true }, { status: 401 });
    console.error('[v1/device/checkin]', err);
    return NextResponse.json({ error: 'Check-in failed. It will be retried.' }, { status: 500 });
  }
}
