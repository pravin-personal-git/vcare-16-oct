import { NextResponse } from 'next/server';
import { deviceFromToken } from '@/server/call-logs';
import { recordTrack, type TrackPoint } from '@/server/attendance-mobile';
import { resolveForUser } from '@/server/app-access';

/** A batch of shift location points from the paired phone (x-device-token). */
export async function POST(req: Request) {
  const device = await deviceFromToken(req.headers.get('x-device-token') ?? '');
  if (!device) return NextResponse.json({ error: 'This phone is not paired.', mustRepair: true }, { status: 401 });
  // Location tracking switched off for this person: accept and drop, so the
  // phone stops resending (Settings > Roles > Phone app, 26 Sep 2026).
  if (!(await resolveForUser(device.userId, [device.storeId])).tracking.location) {
    return NextResponse.json({ stored: 0, tracking: false });
  }
  const body = (await req.json().catch(() => ({}))) as { points?: unknown };
  const points: TrackPoint[] = Array.isArray(body.points)
    ? body.points.flatMap((p) => {
      if (!p || typeof p !== 'object') return [];
      const o = p as Record<string, unknown>;
      const lat = Number(o.lat), lng = Number(o.lng), at = Number(o.at), acc = Number(o.accuracyM), sp = Number(o.speedMps);
      if (![lat, lng, at].every(Number.isFinite)) return [];
      return [{ lat, lng, at, accuracyM: Number.isFinite(acc) ? acc : null, mocked: o.mocked === true, speedMps: Number.isFinite(sp) ? sp : null }];
    })
    : [];
  try {
    return NextResponse.json(await recordTrack(device, points));
  } catch (err) {
    console.error('[v1/attendance/track]', err);
    return NextResponse.json({ error: 'Could not save the points. They will be sent again.' }, { status: 500 });
  }
}
