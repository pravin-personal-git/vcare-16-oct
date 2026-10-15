/**
 * Purchase order status - one axis, not two.
 *
 * `SalesOrder` needs a separate payment axis because a customer pays us for
 * it. A purchase order has no payment of its own: that happens on the Bill it
 * produces once goods actually arrive, so there is nothing here for a second
 * axis to track. One status column, same shape as `PurchaseBill.lifecycle`.
 *
 * `partially_received` and `received` are listed but not reachable through
 * `nextStatus` below - nothing in this codebase can receive against a PO yet.
 * They exist so the column does not need a migration the day a GRN module
 * lands and starts setting them directly, the same way `PurchaseBill.postBill`
 * sets `lifecycle` directly rather than going through a transition function.
 *
 * Pure - no database, no server-only marker.
 *
 * Spec: 10-accounts-purchase.md §8
 */

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export const PO_FLOW: PurchaseOrderStatus[] = ['draft', 'sent', 'approved', 'partially_received', 'received'];

export const ALL_PO_STATUS: PurchaseOrderStatus[] = [...PO_FLOW, 'cancelled'];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

const TERMINAL: PurchaseOrderStatus[] = ['received', 'cancelled'];

export function isTerminal(s: PurchaseOrderStatus): boolean {
  return TERMINAL.includes(s);
}

/** Which status may follow the current one, through this module alone. */
export function nextStatus(current: PurchaseOrderStatus): PurchaseOrderStatus[] {
  if (current === 'draft') return ['sent', 'cancelled'];
  if (current === 'sent') return ['approved', 'cancelled'];
  if (current === 'approved') return ['cancelled'];
  return [];
}

export function canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return nextStatus(from).includes(to);
}

/** Editable while it is still paperwork - before the supplier has been told "yes". */
export function canEdit(s: PurchaseOrderStatus): boolean {
  return s === 'draft' || s === 'sent';
}

/** Cancellable any time before receiving has actually started. */
export function canCancel(s: PurchaseOrderStatus): boolean {
  return s === 'draft' || s === 'sent' || s === 'approved';
}

export function countByStatus(rows: { status: string }[]): Record<PurchaseOrderStatus, number> {
  const out = {} as Record<PurchaseOrderStatus, number>;
  for (const s of ALL_PO_STATUS) out[s] = 0;
  for (const r of rows) {
    if (out[r.status as PurchaseOrderStatus] !== undefined) out[r.status as PurchaseOrderStatus] += 1;
  }
  return out;
}
