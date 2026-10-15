import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { createStaffTransaction, reverseStaffTransaction } from './staff-accounts';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Sales Incentive - spec 10-accounts-purchase.md §1.8.
 *
 * "Linked to the Quotation form's Sales Incentives field" - that field
 * already exists (`Quotation.incentivePaise`, set by hand on the quotation
 * itself, "commission owed on this deal"). This screen doesn't recompute
 * anything; it reads what quotations already earned and tracks whether each
 * has been paid, via a `StaffTransaction` of kind `incentive_paid` linked
 * back with `sourceType: 'quotation_incentive'` - so paying the same
 * quotation twice is something the screen can see, not something that
 * depends on a person remembering.
 *
 * Only 'accepted' or 'converted' quotations count as earned. A draft or a
 * sent-but-undecided quotation is not a deal yet; a rejected or expired one
 * never became one.
 */

const EARNED_STATUSES = ['accepted', 'converted'];
const SOURCE_TYPE = 'quotation_incentive';

export interface IncentiveRow {
  quotationId: string;
  quotationNo: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  quotationDate: Date;
  status: string;
  incentivePaise: number;
  paid: boolean;
  paidTxnId: string | null;
  paidAt: Date | null;
}

export interface IncentiveCards {
  totalIncentives: number;
  totalAmountPaise: number;
  pendingPaise: number;
  paidPaise: number;
}

export async function listIncentives(scope: StoreScope): Promise<{ rows: IncentiveRow[]; cards: IncentiveCards }> {
  const [quotations, payments] = await Promise.all([
    db.quotation.findMany({
      where: { ...scopeWhere(scope), incentivePaise: { gt: 0 }, salespersonId: { not: null }, status: { in: EARNED_STATUSES } },
      select: {
        id: true, quotationNo: true, customerName: true, salespersonId: true,
        createdAt: true, status: true, incentivePaise: true,
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    db.staffTransaction.findMany({
      where: { ...scopeWhere(scope), sourceType: SOURCE_TYPE, status: 'active' },
      select: { id: true, sourceId: true, txnDate: true },
    }),
  ]);

  const paidByQuotation = new Map(payments.map((p) => [p.sourceId, p]));

  const salespersonIds = [...new Set(quotations.map((q) => q.salespersonId).filter((id): id is string => !!id))];
  const salespeople = salespersonIds.length > 0
    ? await db.user.findMany({ where: { id: { in: salespersonIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(salespeople.map((s) => [s.id, s.fullName]));

  const rows: IncentiveRow[] = quotations.map((q) => {
    const payment = paidByQuotation.get(q.id);
    return {
      quotationId: q.id,
      quotationNo: q.quotationNo,
      customerName: q.customerName,
      salespersonId: q.salespersonId as string,
      salespersonName: nameById.get(q.salespersonId as string) ?? 'Unassigned',
      quotationDate: q.createdAt,
      status: q.status,
      incentivePaise: q.incentivePaise,
      paid: payment != null,
      paidTxnId: payment?.id ?? null,
      paidAt: payment?.txnDate ?? null,
    };
  });

  const cards: IncentiveCards = {
    totalIncentives: rows.length,
    totalAmountPaise: rows.reduce((n, r) => n + r.incentivePaise, 0),
    pendingPaise: rows.filter((r) => !r.paid).reduce((n, r) => n + r.incentivePaise, 0),
    paidPaise: rows.filter((r) => r.paid).reduce((n, r) => n + r.incentivePaise, 0),
  };

  return { rows, cards };
}

export async function payIncentive(
  scope: StoreScope, quotationId: string, method: string, userId: string,
): Promise<void> {
  const q = await db.quotation.findFirst({
    where: { id: quotationId, ...scopeWhere(scope) },
    select: { id: true, incentivePaise: true, salespersonId: true, quotationNo: true, status: true },
  });
  if (!q) throw new Error('Quotation not found in your scope.');
  if (!q.salespersonId) throw new Error('This quotation has no salesperson to pay.');
  if (q.incentivePaise <= 0) throw new Error('This quotation has no incentive to pay.');
  if (!EARNED_STATUSES.includes(q.status)) throw new Error('Only an accepted or converted quotation earns an incentive.');

  const existing = await db.staffTransaction.findFirst({
    where: { ...scopeWhere(scope), sourceType: SOURCE_TYPE, sourceId: quotationId, status: 'active' },
    select: { id: true },
  });
  if (existing) throw new Error('This incentive has already been paid.');

  await createStaffTransaction(scope, {
    userId: q.salespersonId,
    kind: 'incentive_paid',
    amountPaise: q.incentivePaise,
    txnDate: new Date(),
    method,
    note: `Incentive on ${q.quotationNo}`,
    sourceType: SOURCE_TYPE,
    sourceId: quotationId,
  }, userId);
}

export async function reverseIncentivePayment(
  scope: StoreScope, quotationId: string, reason: string, userId: string,
): Promise<void> {
  const txn = await db.staffTransaction.findFirst({
    where: { ...scopeWhere(scope), sourceType: SOURCE_TYPE, sourceId: quotationId, status: 'active' },
    select: { id: true },
  });
  if (!txn) throw new Error('No active incentive payment found for this quotation.');
  await reverseStaffTransaction(scope, txn.id, reason, userId);
}
