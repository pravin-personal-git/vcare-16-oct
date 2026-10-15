import 'server-only';
import { db } from './db';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import { businessDay } from './presence';
import {
  findDuplicateExpenses, type DuplicateGroup, type ExpenseCandidate,
} from '@/lib/duplicate-expenses';

/**
 * Collects every door money leaves by and asks `lib/duplicate-expenses` which
 * of them look like the same spend entered twice. See that file for why this
 * exists and what it deliberately does not try to decide.
 *
 * Scope: the last 90 days. Far enough back to catch a claim filed late,
 * short enough that the screen stays fast and the list stays about things
 * somebody can still remember.
 */
const WINDOW_DAYS = 90;

export async function duplicateExpenses(scope: StoreScope): Promise<DuplicateGroup[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [vouchers, bills, claims] = await Promise.all([
    // Only approved ones: a pending voucher has not spent anything yet, and a
    // rejected or reversed one never did.
    db.transaction.findMany({
      where: {
        ...scopeWhere(scope), txnType: 'expense', status: 'approved', txnDate: { gte: since },
      },
      select: {
        id: true, txnNo: true, amountPaise: true, txnDate: true, description: true,
        categoryAccountCode: true, paidToUserId: true,
      },
    }),
    db.purchaseBill.findMany({
      where: { ...scopeWhere(scope), lifecycle: 'received', billDate: { gte: since } },
      select: {
        id: true, billNo: true, billDate: true, supplierName: true,
        // Stock lines are inventory, not an expense - they cannot be the
        // duplicate of a voucher, so they are left out rather than reported
        // as noise.
        items: { where: { movedStock: false }, select: { id: true, productName: true, lineTotalPaise: true } },
      },
    }),
    db.reimbursementClaim.findMany({
      where: {
        ...scopeWhere(scope), status: { in: ['approved', 'paid'] }, expenseDate: { gte: since },
        deletedAt: null,
      },
      select: {
        id: true, amountPaise: true, expenseDate: true, category: true, description: true,
        user: { select: { fullName: true } },
      },
    }),
  ]);

  const names = new Map((await db.user.findMany({
    where: {
      ...userInScope(scope),
      id: { in: [...new Set(vouchers.map((v) => v.paidToUserId).filter((x): x is string => !!x))] },
    },
    select: { id: true, fullName: true },
  })).map((u) => [u.id, u.fullName]));

  const candidates: ExpenseCandidate[] = [
    ...vouchers.map((v) => ({
      id: v.id, door: 'voucher' as const, ref: v.txnNo,
      label: v.description?.trim() || v.categoryAccountCode || 'Expense',
      amountPaise: v.amountPaise, day: businessDay(v.txnDate),
      person: v.paidToUserId ? names.get(v.paidToUserId) ?? null : null,
    })),
    ...bills.flatMap((b) => b.items.map((i) => ({
      id: i.id, door: 'bill' as const, ref: b.billNo,
      label: `${i.productName} · ${b.supplierName}`,
      amountPaise: i.lineTotalPaise, day: businessDay(b.billDate), person: null,
    }))),
    ...claims.map((c) => ({
      id: c.id, door: 'claim' as const, ref: c.category,
      label: c.description?.trim() || c.category,
      amountPaise: c.amountPaise, day: businessDay(c.expenseDate),
      person: c.user.fullName,
    })),
  ];

  return findDuplicateExpenses(candidates);
}
