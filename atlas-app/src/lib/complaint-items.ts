import type { SplitCover } from './amc-coverage';

/**
 * One answer for the whole job from its items (10 Oct 2026, repair flow
 * stage 2): the technician is free only if every item's AMC covers the visit,
 * the parts only if every item's warranty covers it - one charged item makes
 * the visit chargeable, because it is one visit. Items taken off do not count.
 * Null when the job has no live items (an old one-product complaint), so the
 * caller falls back to the complaint-level cover.
 */
export function jobCoverFromItems(items: { status: string; cover: Pick<SplitCover, 'labour' | 'parts'> }[]): { labourFree: boolean; partsFree: boolean } | null {
  const live = items.filter((i) => i.status !== 'cancelled');
  if (!live.length) return null;
  return { labourFree: live.every((i) => i.cover.labour.free), partsFree: live.every((i) => i.cover.parts.free) };
}

/**
 * Where a complaint item can be (repair flow, 10 Oct 2026) - one list, so the
 * handbook's chart and the code cannot disagree. Pickup (stage 3), the
 * supplier (4-5) and the hand-back (6) move it; stage 2 only opens and cancels.
 */
export const COMPLAINT_ITEM_STATUSES = ['open', 'picked_up', 'with_supplier', 'back', 'supplier_closed', 'handed_back', 'declined', 'cancelled'] as const;
