import 'server-only';
import { db } from './db';
import type { StoreScope } from './store-scope';

/**
 * Quotation - send to customer, through Approval Rules (5 Oct 2026). Returns
 * the message to show when it is held, or null to go ahead. Approved once per
 * figure: sending the same quotation again does not ask again, but one edited
 * to a different total does.
 */
export async function gateQuotationSend(scope: StoreScope, userId: string, id: string): Promise<string | null> {
  if (scope.kind !== 'single') return null;
  const q = await db.quotation.findFirst({
    where: { id, storeId: scope.storeId },
    select: {
      quotationNo: true, customerName: true, grandTotalPaise: true, subtotalPaise: true, itemDiscountPaise: true,
      orderDiscountPaise: true, taxableBasePaise: true, costPricePaise: true, transportPaise: true, incentivePaise: true,
    },
  });
  if (!q) return null;
  const { gateAction, pricingOf } = await import('@/server/approval-actions');
  const r = await gateAction(scope, userId, {
    type: 'quotation_send', entityId: id, amountPaise: q.grandTotalPaise,
    title: `Send quotation ${q.quotationNo} ₹${(q.grandTotalPaise / 100).toLocaleString('en-IN')}`,
    summary: q.customerName,
    payload: { grandTotalPaise: q.grandTotalPaise },
    approvedIfSame: { grandTotalPaise: q.grandTotalPaise },
    pricing: pricingOf(q),
  });
  // "Approved and done" = this click was the last approval; the status is set,
  // so the caller carries on (a share link is still wanted).
  return r.held && r.message !== 'Approved and done.' ? r.message : null;
}
