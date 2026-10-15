import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { postJournalEntry } from './ledger';
import { ACCOUNT, amcEarnedPaise } from '@/lib/service-revenue';

/**
 * Releasing AMC income month by month (health check ACC-1, decision 3 of
 * 25 Sep 2026).
 *
 * When a business spreads AMC income, an AMC fee invoice credits "AMC Received
 * in Advance" (2500). This moves the part earned so far into "AMC Income"
 * (4040): for each billed contract, what should be earned by today minus
 * what has already been moved, as one journal entry. Running it twice posts
 * nothing the second time, so it is safe to run on every P&L view and nightly.
 * What went to 2500 is read from the invoice's own journal, so a contract
 * invoiced while the business booked AMC at invoice is never spread twice.
 */
export async function recognizeAmcRevenue(scope: StoreScope, asOf: Date = new Date(), userId = 'system'): Promise<{ posted: number; paise: number }> {
  if (scope.kind !== 'single') return { posted: 0, paise: 0 };
  const contracts = await db.amcContract.findMany({
    where: { ...scopeWhere(scope), invoiceId: { not: null }, amountPaise: { gt: 0 }, status: { not: 'cancelled' }, startDate: { lte: asOf } },
    select: { id: true, contractNo: true, invoiceId: true, startDate: true, endDate: true },
  });
  let posted = 0;
  let paise = 0;
  for (const c of contracts) {
    const [deferred, released] = await Promise.all([
      db.journalLine.aggregate({
        where: { account: { code: ACCOUNT.amcAdvance }, journalEntry: { ...scopeWhere(scope), sourceType: 'invoice', sourceId: c.invoiceId! } },
        _sum: { creditPaise: true, debitPaise: true },
      }),
      db.journalLine.aggregate({
        where: { account: { code: ACCOUNT.amcAdvance }, journalEntry: { ...scopeWhere(scope), sourceType: 'amc_recognition', sourceId: c.id } },
        _sum: { debitPaise: true, creditPaise: true },
      }),
    ]);
    const held = (deferred._sum.creditPaise ?? 0) - (deferred._sum.debitPaise ?? 0);
    if (held <= 0) continue;
    const already = (released._sum.debitPaise ?? 0) - (released._sum.creditPaise ?? 0);
    const due = amcEarnedPaise(held, c.startDate, c.endDate, asOf) - already;
    if (due <= 0) continue;
    await postJournalEntry(scope, {
      entryDate: asOf,
      description: `AMC income released - ${c.contractNo}`,
      sourceType: 'amc_recognition',
      sourceId: c.id,
      lines: [
        { accountCode: ACCOUNT.amcAdvance, debitPaise: due },
        { accountCode: ACCOUNT.amcIncome, creditPaise: due },
      ],
    }, userId);
    posted += 1;
    paise += due;
  }
  return { posted, paise };
}

export async function getAmcRevenueMode(organizationId: string): Promise<'spread' | 'at_invoice'> {
  const o = await db.organization.findUnique({ where: { id: organizationId }, select: { amcRevenueMode: true } });
  return o?.amcRevenueMode === 'at_invoice' ? 'at_invoice' : 'spread';
}

export async function setAmcRevenueMode(organizationId: string, mode: 'spread' | 'at_invoice'): Promise<void> {
  await db.organization.update({ where: { id: organizationId }, data: { amcRevenueMode: mode } });
}
