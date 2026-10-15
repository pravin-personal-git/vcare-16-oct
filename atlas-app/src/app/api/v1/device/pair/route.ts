import { NextResponse } from 'next/server';
import { CallLogError, redeemPairing } from '@/server/call-logs';

/**
 * Vcare pairs a phone: the code an admin created for a named employee is
 * exchanged for this phone's own long-lived device token. The code IS the
 * authentication here, and it works once. Pairing this phone switches off the
 * employee's previous phone (server/call-logs redeemPairing).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400 });
  const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.slice(0, max) : null);
  try {
    const r = await redeemPairing(str(body.code, 20) ?? '', {
      model: str(body.deviceModel),
      androidVersion: str(body.androidVersion, 20),
      appVersion: str(body.appVersion, 40),
      androidId: str(body.androidId, 64),
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
    return NextResponse.json({
      deviceToken: r.token,
      userId: r.userId,
      userName: r.userName,
      storeName: r.storeName,
      captureMode: r.captureMode,
    });
  } catch (err) {
    if (err instanceof CallLogError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[v1/device/pair]', err);
    return NextResponse.json({ error: 'Pairing failed. Try again.' }, { status: 500 });
  }
}
