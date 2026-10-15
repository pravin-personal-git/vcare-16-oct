import { NextResponse } from 'next/server';
import { AttendanceDeviceError, deviceFromToken, ingestPunches } from '@/server/attendance-devices';

/**
 * Where a biometric/punch machine posts attendance.
 *
 * Authenticated by `Authorization: Bearer <device token>` - not a session
 * cookie. This runs unattended on a machine for months; there is nobody to
 * log in again. Same shape as `api/call-logs/sync/route.ts` deliberately -
 * see the note there on why GET exists (a revoked device needs a way to
 * find out it is dead, rather than posting into a 401 forever).
 */

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

export async function GET(req: Request) {
  const device = await deviceFromToken(bearer(req));
  if (!device) {
    return NextResponse.json(
      { error: 'This device is not paired, or has been revoked.', paired: false },
      { status: 401 },
    );
  }

  return NextResponse.json({
    paired: true,
    serverTime: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  try {
    const device = await deviceFromToken(bearer(req));
    if (!device) {
      return NextResponse.json(
        { error: 'This device is not paired, or has been revoked.', paired: false },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.punches)) {
      return NextResponse.json({ error: 'Send { "punches": [...] }.' }, { status: 400 });
    }

    const result = await ingestPunches(device, body.punches);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AttendanceDeviceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[attendance/devices/sync]', err);
    return NextResponse.json({ error: 'Sync failed. It will be retried.' }, { status: 500 });
  }
}
