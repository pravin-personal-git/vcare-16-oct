import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { recognizeAmcRevenue } from '@/server/amc-revenue';
import { runReminders } from '@/server/reminders';

/**
 * The morning job, 08:00 India time (27 Sep 2026). Two things every branch
 * needs once a day, in one scheduled route so the project stays within the
 * plan's cron-job limit:
 *   - AMC income earned so far moves out of AMC Received in Advance (ACC-1;
 *     it used to run alone as /api/cron/amc-revenue, which still works by hand);
 *   - renewal reminders, personal reminders, approval nudges / escalations and
 *     the owner's morning summary (NOTIFICATIONS-APPROVALS-SPEC.md).
 * Guarded by CRON_SECRET like every scheduled route. Each branch is its own
 * try, so one failing branch never stops the rest.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set.' }, { status: 503 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });

  const amcStores = await db.amcContract.findMany({ where: { invoiceId: { not: null } }, distinct: ['storeId'], select: { storeId: true } });
  let posted = 0;
  for (const s of amcStores) {
    try {
      posted += (await recognizeAmcRevenue({ kind: 'single', storeId: s.storeId, writable: true })).posted;
    } catch (e) {
      console.error('[daily] amc store failed', s.storeId, e);
    }
  }

  const stores = await db.store.findMany({ select: { id: true } });
  let sent = 0;
  for (const s of stores) {
    try {
      const r = await runReminders(s.id, { force: true });
      sent += r.sent ?? 0;
    } catch (e) {
      console.error('[daily] reminders store failed', s.id, e);
    }
  }
  console.log('[daily]', JSON.stringify({ amcStores: amcStores.length, posted, stores: stores.length, sent }));
  return NextResponse.json({ amcStores: amcStores.length, posted, stores: stores.length, sent });
}
