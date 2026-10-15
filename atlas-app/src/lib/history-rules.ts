/**
 * When a quotation or sales order leaves the Active list for History
 * (4 Oct 2026, Pravin's call).
 *
 * Until then only the Close button moved anything, so a delivered, invoiced,
 * fully paid order sat in Active for ever and History was empty unless somebody
 * remembered to close things by hand. Now a document goes to History on its
 * own once its work is done, and Close stays for work abandoned half way.
 *
 * Worked out on read, never stored, for the same reason `closedAt` is not a
 * status (see server/archive.ts): the document keeps its real status, and old
 * documents land in the right list the first time the screen is opened.
 *
 *   Quotation  converted or rejected. EXPIRED STAYS ACTIVE: an expired quote
 *              is often revived with a new date and sent again, so it is
 *              closed by hand when given up on.
 *   Order      delivered + invoiced + fully paid, or ended (void, failed,
 *              refunded, returned). Delivered with money still owed stays
 *              Active, or the due would disappear from the working list.
 */

export type HistoryReason = 'closed' | 'converted' | 'rejected' | 'completed' | 'ended';

export const HISTORY_REASON_LABEL: Record<HistoryReason, string> = {
  closed: 'Closed by hand',
  converted: 'Became an order',
  rejected: 'Customer declined',
  completed: 'Delivered, invoiced and paid',
  ended: 'Order ended',
};

export function quotationHistoryReason(q: { status: string; closedAt: Date | null }): HistoryReason | null {
  if (q.closedAt) return 'closed';
  if (q.status === 'converted') return 'converted';
  if (q.status === 'rejected') return 'rejected';
  return null;
}

/** Fulfilment statuses after which nothing more will happen to an order. */
export const ENDED_FULFILMENT = ['void', 'failed', 'refunded', 'returned'] as const;

export function orderHistoryReason(o: {
  fulfilmentStatus: string;
  closedAt: Date | null;
  isInvoiced: boolean;
  /**
   * Is the money in? The order's own paid figure only covers advances taken
   * before invoicing - after that, payments are recorded on the invoice - so
   * the caller works this out from both.
   */
  fullyPaid: boolean;
}): HistoryReason | null {
  if (o.closedAt) return 'closed';
  if ((ENDED_FULFILMENT as readonly string[]).includes(o.fulfilmentStatus)) return 'ended';
  if (o.fulfilmentStatus === 'delivered' && o.isInvoiced && o.fullyPaid) return 'completed';
  return null;
}

/** Only a document closed by hand can be reopened; the others are in History because of what they are. */
export const canReopen = (reason: HistoryReason | null) => reason === 'closed';
