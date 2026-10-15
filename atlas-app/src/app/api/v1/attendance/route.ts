import { NextResponse } from 'next/server';
import { deviceFromToken } from '@/server/call-logs';
import { AttendanceGeoError } from '@/server/attendance-geo';
import { fixFromBody, phoneToday, punch, PunchBlocked } from '@/server/attendance-mobile';
import { resolveForUser } from '@/server/app-access';

/**
 * Vcare clock in / clock out. The paired phone's device token
 * (x-device-token) says who and which store - never the body.
 */

const UNPAIRED = { error: 'This phone is not paired, or has been switched off by your admin.', mustRepair: true };

export async function GET(req: Request) {
  const device = await deviceFromToken(req.headers.get('x-device-token') ?? '');
  if (!device) return NextResponse.json(UNPAIRED, { status: 401 });
  const access = await resolveForUser(device.userId, [device.storeId]);
  return NextResponse.json({ ...(await phoneToday(device)), appClockIn: access.tracking.clockIn, tracking: access.tracking });
}

export async function POST(req: Request) {
  const device = await deviceFromToken(req.headers.get('x-device-token') ?? '');
  if (!device) return NextResponse.json(UNPAIRED, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === 'out' ? 'out' : body.action === 'in' ? 'in' : null;
  if (!action) return NextResponse.json({ error: 'Say whether this is a clock in or out.' }, { status: 400 });
  // Settings > Roles > Phone app: clock-in from the app can be switched off.
  // Clocking OUT of a shift already open is always allowed.
  if (action === 'in' && !(await resolveForUser(device.userId, [device.storeId])).tracking.clockIn) {
    return NextResponse.json({ error: 'Clocking in from the app is switched off for you. Mark attendance the usual way, or ask your admin.', blocked: true }, { status: 422 });
  }
  const fix = fixFromBody(body.fix);
  try {
    const r = await punch(device, {
      action,
      fix,
      mocked: body.mocked === true,
      clientTime: typeof body.clientTime === 'number' ? body.clientTime : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
    /**
     * The photo is stored AFTER attendance, and never allowed to fail it
     * (F2.5, D14).
     *
     * A photograph that will not upload must not stop somebody starting work.
     * That is the same rule `attendance-geo.ts` has followed since September
     * for a poor GPS fix: the check is recorded, not enforced. `storeSelfie`
     * swallows its own errors and returns null, and the punch stands either
     * way.
     */
    if (typeof body.photo === 'string' && body.photo.length > 0) {
      const { storeSelfie } = await import('@/server/attendance-capture/selfie');
      await storeSelfie({
        userId: device.userId,
        storeId: device.storeId,
        sessionId: r.sessionId,
        direction: action,
        capturedAt: typeof body.clientTime === 'number' ? new Date(body.clientTime) : new Date(),
        fix: fix && { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null },
        mocked: body.mocked === true,
        mimeType: typeof body.photoType === 'string' ? body.photoType : 'image/jpeg',
        bytes: Buffer.from(body.photo, 'base64').buffer as ArrayBuffer,
      }).catch(() => null);
    }

    return NextResponse.json({ ...r, today: await phoneToday(device) });
  } catch (err) {
    if (err instanceof PunchBlocked) return NextResponse.json({ error: err.message, blocked: true }, { status: 422 });
    if (err instanceof AttendanceGeoError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[v1/attendance]', err);
    return NextResponse.json({ error: 'Could not save that. It will be tried again.' }, { status: 500 });
  }
}
