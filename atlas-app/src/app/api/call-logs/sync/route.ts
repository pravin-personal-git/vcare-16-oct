import { NextResponse } from 'next/server';
import { CallLogError, deviceFromToken, ingestCalls, touchDevice } from '@/server/call-logs';
import { currentShift, recordPing } from '@/server/shifts';
import { workedMinutes } from '@/lib/shift';
import type { Fix } from '@/lib/shift';
import type { IncomingCall } from '@/lib/call-log';

/**
 * Where the phone posts its call log.
 *
 * Authenticated by `Authorization: Bearer <device token>` - not a session
 * cookie. This runs unattended on a handset for months; there is nobody to log
 * in again.
 *
 * WHY GET EXISTS TOO
 *
 * The app calls GET on start-up to ask "am I still paired, and what should I
 * send?". Without it, a revoked device would keep collecting call logs and
 * posting them into a 401 forever, and the employee would have no way to know
 * their phone had stopped counting. GET is how the app finds out it is dead.
 */

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/**
 * An optional location fix riding along with the sync.
 *
 * Carried on this request rather than sent as its own, because a field phone on
 * a weak 3G signal pays for every round trip - and the two are wanted at
 * exactly the same moment anyway. A ping that fails must never fail the sync it
 * travelled with: calls are the product, a location fix is a bonus.
 */
function fixFrom(v: unknown): Fix | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acc = Number(o.accuracyM);
  return { lat, lng, accuracyM: Number.isFinite(acc) ? Math.round(acc) : null };
}

/** Health check and resume point. */
export async function GET(req: Request) {
  const device = await deviceFromToken(bearer(req));
  if (!device) {
    return NextResponse.json(
      { error: 'This device is not paired, or has been revoked.', paired: false },
      { status: 401 },
    );
  }

  // A GET is a phone checking in. It counts as reporting, and must - the app
  // only POSTs when it has calls to send, so a phone whose owner made no calls
  // today would otherwise show as "Never reported" on the Devices screen and
  // send a manager chasing a battery problem that does not exist.
  await touchDevice(device.id);

  // Folded in here rather than left to a second request to /shift. The phone
  // wants both on every launch, and `currentShift` also closes anything left
  // open past the ceiling - so a handset switched off for two days is told it
  // has no open shift instead of being handed a stale one to append to.
  const shift = await currentShift(device);

  return NextResponse.json({
    paired: true,
    captureMode: device.captureMode,
    // The app sends everything after this, so a phone that was asleep for two
    // days knows exactly how far back to reach without re-uploading its life.
    lastCallAt: device.lastCallAt ? device.lastCallAt.toISOString() : null,
    shift: shift
      ? {
          id: shift.id,
          startedAt: shift.startedAt.toISOString(),
          workedMinutes: workedMinutes(shift, new Date()),
        }
      : null,
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
    if (!body || !Array.isArray(body.calls)) {
      return NextResponse.json(
        { error: 'Send { "calls": [...] }.' },
        { status: 400 },
      );
    }

    /**
     * Shaped, not validated hard.
     *
     * Anything unusable is dropped by `prepareCall` and counted as `invalid` in
     * the response, rather than failing the batch. A phone syncing 400 calls
     * must not lose all of them because one row had a blank number - and the
     * app cannot fix a bad row anyway, so refusing the batch would just make it
     * retry the same bad row forever.
     */
    const calls: IncomingCall[] = body.calls.map((c: Record<string, unknown>) => ({
      number: String(c?.number ?? ''),
      type: typeof c?.type === 'number' ? c.type : undefined,
      direction: typeof c?.direction === 'string' ? c.direction : undefined,
      startedAtMs: Number(c?.startedAtMs ?? c?.date ?? 0),
      durationSec: Number(c?.durationSec ?? c?.duration ?? 0),
    }));

    const result = await ingestCalls(device, calls);

    // After the calls are safely in, never before. A location fix is a bonus
    // and must not be able to fail the thing that is actually the product -
    // hence the swallowed error rather than a throw.
    const fix = fixFrom(body.location);
    if (fix) {
      try {
        await recordPing(device, fix, 'sync');
      } catch (e) {
        console.error('[call-logs/sync] ping failed, calls were saved', e);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CallLogError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[call-logs/sync]', err);
    return NextResponse.json({ error: 'Sync failed. It will be retried.' }, { status: 500 });
  }
}
