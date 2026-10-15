/**
 * SUPPLIER DISPATCH - the pure rules (10 Oct 2026, repair flow stage 4).
 *
 * One box to one supplier can carry many supplier cases, from many
 * complaints. Two questions about that box are rules, not reads, so they live
 * here with tests: how its courier charge is shared across the cases, and
 * what state the box is in from the state of the cases inside it.
 */

export const DISPATCH_STATUSES = ['sent', 'part_back', 'back', 'cancelled'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  sent: 'With the supplier',
  part_back: 'Partly back',
  back: 'All back',
  cancelled: 'Cancelled',
};

export const COURIER_PAID_BY = ['cash', 'bank', 'none'] as const;
export type CourierPaidBy = (typeof COURIER_PAID_BY)[number];
export const COURIER_PAID_BY_LABEL: Record<CourierPaidBy, string> = {
  cash: 'Paid in cash',
  bank: 'Paid from the bank / UPI',
  none: 'Not paid by us (supplier pays, or to pay later)',
};

/**
 * Share a courier charge across the cases in the box, in paise, so the shares
 * always add up to the charge exactly.
 *
 * `equal` splits it evenly. `value` splits by what each item is worth (its
 * cost), so a ₹40,000 NVR carries more of the freight than a ₹300 adaptor;
 * an item with no value on file counts as the average of the others, and if
 * none has a value it falls back to equal. The paisa left over by rounding
 * goes to the first case.
 */
export function splitCharge(totalPaise: number, values: (number | null)[], mode: 'equal' | 'value'): number[] {
  const n = values.length;
  if (n === 0 || totalPaise <= 0) return values.map(() => 0);
  let weights: number[];
  const known = values.filter((v): v is number => v !== null && v > 0);
  if (mode === 'value' && known.length) {
    const avg = known.reduce((a, b) => a + b, 0) / known.length;
    weights = values.map((v) => (v !== null && v > 0 ? v : avg));
  } else {
    weights = values.map(() => 1);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((totalPaise * w) / sum));
  shares[0] += totalPaise - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/**
 * The box's state from its cases. Out (`sent`) until something comes back;
 * `part_back` while some are still out; `back` when none is out. A cancelled
 * case does not hold the box open. A box whose every case was cancelled is
 * cancelled.
 */
export function dispatchStatusFor(caseStatuses: string[]): DispatchStatus {
  const live = caseStatuses.filter((s) => s !== 'cancelled');
  if (!live.length) return 'cancelled';
  const out = live.filter((s) => s === 'sent' || s === 'open').length;
  if (out === live.length) return 'sent';
  return out === 0 ? 'back' : 'part_back';
}

/** A tracking link is opened from the screen, so it must be a plain web address. */
export function cleanTrackingUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
