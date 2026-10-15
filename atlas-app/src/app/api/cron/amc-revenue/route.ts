import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { recognizeAmcRevenue } from '@/server/amc-revenue';

/** Nightly: move AMC income earned so far out of AMC Received in Advance, every branch (ACC-1). */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set.' }, { status: 503 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  const stores = await db.amcContract.findMany({ where: { invoiceId: { not: null } }, distinct: ['storeId'], select: { storeId: true } });
  let posted = 0;
  for (const s of stores) {
    try {
      posted += (await recognizeAmcRevenue({ kind: 'single', storeId: s.storeId, writable: true })).posted;
    } catch (e) {
      console.error('[amc-revenue] store failed', s.storeId, e);
    }
  }
  console.log('[amc-revenue]', JSON.stringify({ stores: stores.length, posted }));
  return NextResponse.json({ stores: stores.length, posted });
}
