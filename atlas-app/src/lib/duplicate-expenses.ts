/**
 * THE SAME SPEND, ENTERED TWICE UNDER TWO NAMES (8 Oct 2026).
 *
 * Atlas has four doors money can leave by - an expense voucher, a purchase
 * bill line, a reimbursement claim, and a staff advance - and none of them
 * knows about the others. So one petrol bill can be paid from petty cash AND
 * claimed back by the person who bought it, and the books will show both,
 * balanced and correct, for twice the money.
 *
 * No automatic rule can know which is wrong, so this one does not guess. It
 * finds what deserves a human look - the same amount, close together - and
 * says why. Deliberately crude about the WHAT (an exact amount match) and
 * deliberately loud about the WHERE (two different doors is more suspicious
 * than two of the same, because that is the case nobody is watching for).
 *
 * Pure - no database, so the rule can be tested on its own.
 */

export type ExpenseDoor = 'voucher' | 'bill' | 'claim';

export const DOOR_LABEL: Record<ExpenseDoor, string> = {
  voucher: 'Expense voucher',
  bill: 'Purchase bill',
  claim: 'Reimbursement claim',
};

export interface ExpenseCandidate {
  id: string;
  door: ExpenseDoor;
  /** Document number or other human reference. */
  ref: string;
  /** What it says it was for - description, supplier, category. */
  label: string;
  amountPaise: number;
  /** `YYYY-MM-DD`, India time, worked out by the caller. */
  day: string;
  /** Who took the cash or claimed it, if anybody is named. */
  person: string | null;
}

export interface DuplicateGroup {
  amountPaise: number;
  /** Why a person is being asked to look. */
  reason: string;
  /** Biggest first, so a ₹40,000 pair is never buried under a pair of ₹50 chais. */
  entries: ExpenseCandidate[];
}

const daysApart = (a: string, b: string) =>
  Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Entries worth a second look, biggest amount first.
 *
 * `windowDays` is how far apart two entries can be and still look like the
 * same thing entered twice - 7 by default, because a claim for Monday's
 * petrol is often filed on Friday.
 *
 * `minPaise` keeps the list readable: two ₹20 chais on the same day are
 * almost certainly two chais.
 */
export function findDuplicateExpenses(
  rows: ExpenseCandidate[], windowDays = 7, minPaise = 10_000,
): DuplicateGroup[] {
  const byAmount = new Map<number, ExpenseCandidate[]>();
  for (const r of rows) {
    if (r.amountPaise < minPaise) continue;
    const list = byAmount.get(r.amountPaise) ?? [];
    list.push(r);
    byAmount.set(r.amountPaise, list);
  }

  const groups: DuplicateGroup[] = [];

  for (const [amountPaise, all] of byAmount) {
    if (all.length < 2) continue;
    const sorted = [...all].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));

    // Walk the dates and keep a cluster going while the next entry is still
    // within the window of the one before it.
    let cluster: ExpenseCandidate[] = [];
    const flush = () => {
      if (cluster.length >= 2) groups.push({ amountPaise, reason: reasonFor(cluster, windowDays), entries: cluster });
      cluster = [];
    };
    for (const r of sorted) {
      if (cluster.length === 0 || daysApart(cluster[cluster.length - 1]!.day, r.day) <= windowDays) cluster.push(r);
      else { flush(); cluster = [r]; }
    }
    flush();
  }

  return groups.sort((a, b) => b.amountPaise - a.amountPaise);
}

function reasonFor(cluster: ExpenseCandidate[], windowDays: number): string {
  const doors = [...new Set(cluster.map((c) => c.door))];
  const sameDay = cluster.every((c) => c.day === cluster[0]!.day);
  const when = sameDay ? 'on the same day' : `within ${windowDays} days`;

  if (doors.length > 1) {
    return `Entered ${when} in ${doors.length} different places - ${doors.map((d) => DOOR_LABEL[d]).join(' and ')}. `
      + 'This is the one that is usually a real duplicate: the same spend paid once and claimed back again.';
  }

  const people = [...new Set(cluster.map((c) => c.person).filter(Boolean))];
  if (people.length === 1 && cluster.length > 1) {
    return `${cluster.length} entries of the same amount ${when}, all against ${people[0]}.`;
  }
  return `${cluster.length} entries of the same amount ${when}, in ${DOOR_LABEL[doors[0]!]}.`;
}
