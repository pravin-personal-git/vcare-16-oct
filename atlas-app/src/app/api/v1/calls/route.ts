import { NextResponse } from 'next/server';
import { CallLogError } from '@/server/call-log-error';
import { deviceFromToken, ingestCalls } from '@/server/call-logs';
import type { IncomingCall } from '@/lib/call-log';
import { resolveForUser } from '@/server/app-access';
import { db } from '@/server/db';

/**
 * Vcare call upload (health check CALL-4) - the same ingest as the old
 * Call Sync app's /api/call-logs/sync, under the v1 API with the phone's
 * device token in x-device-token like every other Vcare route.
 *
 *   GET  -> { lastCallAt }: where the phone should resume reading its call log
 *   POST { calls: [{ number, type, startedAtMs, durationSec }] }
 */
async function device(req: Request) {
  return deviceFromToken(req.headers.get('x-device-token') ?? '');
}

export async function GET(req: Request) {
  const d = await device(req);
  if (!d) return NextResponse.json({ error: 'This phone is not paired.', mustRepair: true }, { status: 401 });
  // The app reached its call step (Phones page: "why no calls", 27 Sep 2026).
  await db.callSyncDevice.update({ where: { id: d.id }, data: { lastCallCheckAt: new Date() } }).catch(() => undefined);
  const enabled = (await resolveForUser(d.userId, [d.storeId])).tracking.callLog;
  return NextResponse.json({ lastCallAt: d.lastCallAt ? d.lastCallAt.toISOString() : null, captureMode: d.captureMode, enabled });
}

export async function POST(req: Request) {
  const d = await device(req);
  if (!d) return NextResponse.json({ error: 'This phone is not paired.', mustRepair: true }, { status: 401 });
  // Call-log sync switched off for this person: nothing is stored (Settings > Roles > Phone app).
  if (!(await resolveForUser(d.userId, [d.storeId])).tracking.callLog) {
    return NextResponse.json({ accepted: 0, duplicates: 0, skippedByPolicy: 0, invalid: 0, serverTime: new Date().toISOString(), disabled: true });
  }
  const body = (await req.json().catch(() => null)) as { calls?: unknown } | null;
  if (!body || !Array.isArray(body.calls)) return NextResponse.json({ error: 'Send { "calls": [...] }.' }, { status: 400 });
  const calls: IncomingCall[] = body.calls.map((c: Record<string, unknown>) => ({
    number: String(c?.number ?? ''),
    type: typeof c?.type === 'number' ? c.type : undefined,
    direction: typeof c?.direction === 'string' ? c.direction : undefined,
    startedAtMs: Number(c?.startedAtMs ?? 0),
    durationSec: Number(c?.durationSec ?? 0),
  }));
  try {
    return NextResponse.json(await ingestCalls(d, calls));
  } catch (err) {
    // Kept on the phone's row so the Phones page can say what went wrong -
    // a failed upload used to leave no trace outside the server log.
    const why = err instanceof Error ? err.message : String(err);
    await db.callSyncDevice.update({ where: { id: d.id }, data: { lastCallSyncError: why.slice(0, 300) } }).catch(() => undefined);
    if (err instanceof CallLogError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[v1/calls]', err);
    return NextResponse.json({ error: 'Could not save the calls. They will be sent again.' }, { status: 500 });
  }
}
