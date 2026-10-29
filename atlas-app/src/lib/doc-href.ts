/**
 * Where a stock document opens, from the `refType` a movement or unit event
 * carries (29 Oct 2026). One map, so Product History, the unit trail and the
 * serial panels all open the same page for the same document.
 */
export function docHref(refType: string | null, refId: string | null, refNo: string | null): string | null {
  const no = refNo ? encodeURIComponent(refNo) : null;
  switch (refType) {
    case 'MaterialIssue':
    case 'JobChallanLine':
      return no ? `/goods-dispatch/complaint-gdns?gdn=${no}#gdn-${no}` : null;
    case 'invoice': return refId ? `/invoices/${refId}` : null;
    case 'SalesOrder': return refId ? `/sales/orders/${refId}` : null;
    case 'SalesReturn': return refId ? `/sales-return/${refId}` : null;
    case 'PurchaseReturn': return '/purchase-return';
    case 'GoodsReceiptNote': return refId ? `/goods-receipt/${refId}` : null;
    case 'RmaReceipt': return refId ? `/services/dispatch/receipts/${refId}` : null;
    case 'ReplacementCase': return no ? `/services/replacements?q=${no}` : null;
    case 'ProductionOrder': return '/manufacturing/orders';
    case 'Van': return '/van-stock';
    default: return null;
  }
}
