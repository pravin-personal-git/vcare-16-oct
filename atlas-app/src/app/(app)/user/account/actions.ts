'use server';

import { requireContext } from '@/server/context';
import { listStaffTransactionsForUser } from '@/server/staff-accounts';

/**
 * Staff Account became a read on 9 Oct 2026, so the only action it still needs
 * is the one that opens somebody's history.
 *
 * What used to be here, and where it went:
 *   Add transaction      -> HRM > Loans & Salary Advances (loan, advance,
 *                           repayment) and HRM > Payroll > Claims (a claim)
 *   Reverse              -> the document that created it
 *   Advance recovery     -> HRM > Loans & Salary Advances
 *
 * The screen offered one undated, unscheduled way to move staff money, and
 * nothing ever collected what went out through it.
 */
export async function loadTransactionsForUser(userId: string) {
  const ctx = await requireContext();
  const rows = await listStaffTransactionsForUser(ctx.scope, userId);
  return rows.map((r) => ({ ...r, txnDate: r.txnDate.toISOString() }));
}
