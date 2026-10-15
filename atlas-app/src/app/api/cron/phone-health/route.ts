import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { checkPhoneHealth } from '@/server/phone-health';

/**
 * Nightly backstop for phone health (health check CALL-5): records
 * "not reporting" / "reporting again" for every branch, so the history is
 * complete even on a day nobody opened the Phones page. Guarded by
 * CRON_SECRET like every scheduled route.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set.' }, { status: 503 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }
  const stores = await db.callSyncDevice.findMany({ where: { isActive: true }, distinct: ['storeId'], select: { storeId: true } });
  let notReporting = 0;
  for (const s of stores) {
    const r = await checkPhoneHealth({ kind: 'single', storeId: s.storeId, writable: true });
    notReporting += r.notReporting;
  }
  console.log('[phone-health]', JSON.stringify({ stores: stores.length, notReporting }));
  return NextResponse.json({ stores: stores.length, notReporting });
}
