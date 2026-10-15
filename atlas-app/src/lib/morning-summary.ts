import { formatCurrency, formatCurrencyCompact } from './format';

/**
 * The owner's morning summary, as words (6 Oct 2026).
 *
 * The first version listed only approvals, renewals, reminders and job counts
 * - and sent nothing at all when those were zero, so most mornings an owner
 * got a notification that said almost nothing (Pravin: "usme kuch hota hi
 * nahin h"). An owner opens the phone at 8 AM wanting four answers: what came
 * in yesterday, who owes us, what is stuck in the field, and what is waiting
 * on me. Every line here answers one of them, and the money and job lines are
 * always present - "nothing sold yesterday" is itself worth knowing.
 *
 * Pure: the server gathers the figures (server/reminders.ts), this only words
 * them, so it can be tested without a database.
 */

export interface MorningFacts {
  /** Invoices issued (not draft, not cancelled) dated yesterday. */
  salesPaise: number;
  invoiceCount: number;
  /** Receipts received yesterday (bounced/reversed excluded). */
  collectedPaise: number;
  receiptCount: number;
  /** Everything customers owe on issued invoices. */
  receivablePaise: number;
  /** The part of it already past its due date, and from how many customers. */
  overduePaise: number;
  overdueCustomers: number;
  /** The customer who owes the most overdue money, if anyone does. */
  biggestDebtor: { name: string; paise: number } | null;
  /** What the business owes suppliers on posted bills. */
  payablePaise: number;
  // field jobs
  jobsOpen: number;
  jobsUnassigned: number;
  jobsMissedDeadline: number;
  jobsNewYesterday: number;
  jobsClosedYesterday: number;
  jobsWaitingClose: number;
  // the rest
  reorderCount: number;
  outOfStockCount: number;
  newLeadsYesterday: number;
  approvals: number;
  renewalsWeek: number;
  renewalsOverdue: number;
  remindersToday: number;
}

const rs = (p: number) => (p >= 1_00_000_00 ? formatCurrencyCompact(p) : formatCurrency(p).replace(/\.00$/, ''));
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The notification body: one short line per subject, newest concern first within each. */
export function morningSummaryText(f: MorningFacts): string {
  const lines: string[] = [];

  // 1. Yesterday's money - always.
  lines.push(f.salesPaise || f.collectedPaise
    ? `Yesterday: sold ${rs(f.salesPaise)} (${n(f.invoiceCount, 'invoice')}) · collected ${rs(f.collectedPaise)} (${n(f.receiptCount, 'receipt')})`
    : 'Yesterday: no invoice issued and no payment received');

  // 2. Who owes us.
  if (f.receivablePaise > 0) {
    let owed = `Owed to you: ${rs(f.receivablePaise)}`;
    if (f.overduePaise > 0) owed += ` · ${rs(f.overduePaise)} overdue from ${n(f.overdueCustomers, 'customer')}`;
    if (f.biggestDebtor) owed += ` · biggest: ${f.biggestDebtor.name} ${rs(f.biggestDebtor.paise)}`;
    lines.push(owed);
  } else {
    lines.push('Owed to you: nothing outstanding');
  }

  // 3. What we owe.
  if (f.payablePaise > 0) lines.push(`You owe suppliers: ${rs(f.payablePaise)}`);

  // 4. The field - always.
  const jobs = [`${f.jobsOpen} open`];
  if (f.jobsUnassigned) jobs.push(`${f.jobsUnassigned} with no technician`);
  if (f.jobsMissedDeadline) jobs.push(`${f.jobsMissedDeadline} past deadline`);
  if (f.jobsWaitingClose) jobs.push(`${f.jobsWaitingClose} waiting to close`);
  jobs.push(`yesterday ${f.jobsNewYesterday} new, ${f.jobsClosedYesterday} closed`);
  lines.push(`Jobs: ${jobs.join(' · ')}`);

  // 5. Stock and sales, only when there is something to act on.
  if (f.outOfStockCount || f.reorderCount) {
    const st = [];
    if (f.outOfStockCount) st.push(`${n(f.outOfStockCount, 'product')} out of stock`);
    if (f.reorderCount) st.push(`${f.reorderCount} at or below reorder level`);
    lines.push(`Stock: ${st.join(' · ')}`);
  }
  if (f.newLeadsYesterday) lines.push(`Sales: ${n(f.newLeadsYesterday, 'new lead')} yesterday`);

  // 6. Waiting on you.
  const mine = [];
  if (f.approvals) mine.push(n(f.approvals, 'approval'));
  if (f.renewalsOverdue) mine.push(`${n(f.renewalsOverdue, 'renewal')} overdue`);
  if (f.renewalsWeek) mine.push(`${n(f.renewalsWeek, 'renewal')} due this week`);
  if (f.remindersToday) mine.push(`${n(f.remindersToday, 'reminder')} today`);
  if (mine.length) lines.push(`Waiting on you: ${mine.join(' · ')}`);

  return lines.join('\n');
}
