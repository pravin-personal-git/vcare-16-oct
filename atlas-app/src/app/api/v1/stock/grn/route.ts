import { field, jsonBody, requireAction, str, V1Error } from '@/server/auth/v1-staff';
import { listGrns, receiveGoods, type GrnLineDraft } from '@/server/goods-receipt';

/** Recent goods receipts - the store keeper's list. */
export async function GET(req: Request) {
  return field(req, ['purchase.view', 'purchase.edit', 'stock.view'], 'stock', async (ctx, access) => {
    const rows = await listGrns(ctx.scope);
    return {
      grns: rows.slice(0, 50).map((g) => ({
        id: g.id, grnNo: g.grnNo, supplierName: g.supplierName, receivedDate: g.receivedDate,
        status: g.status, supplierInvoiceNo: g.supplierInvoiceNo, qty: g.items.reduce((n, i) => n + i.qty, 0),
      })),
      canReceive: ctx.scope.kind === 'single' && access.actions['stock.receive'],
      canScanBill: access.actions['stock.scanBill'],
      hidePurchaseRate: access.hide.purchaseRate,
    };
  });
}

/**
 * Receive goods at the door, from the phone: supplier, their invoice number,
 * and lines with scanned serials. The same one-step receiveGoods the website
 * uses - every serial is checked before a number is used.
 */
export async function POST(req: Request) {
  return field(req, 'purchase.edit', 'stock', async (ctx, access) => {
    requireAction(access, 'stock.receive', 'Receiving goods');
    // Purchase rate hidden for this person: saved at 0 for the office to fill in (decided 26 Sep).
    const zeroRate = access.hide.purchaseRate;
    const b = await jsonBody(req);
    const partyId = str(b.partyId, 60);
    if (!partyId) throw new V1Error('Choose the supplier.');
    const raw = Array.isArray(b.lines) ? b.lines.slice(0, 100) : [];
    const lines: GrnLineDraft[] = raw.map((l: unknown) => {
      const o = (l ?? {}) as Record<string, unknown>;
      const serials = Array.isArray(o.serials) ? o.serials.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 500) : [];
      return {
        productId: str(o.productId, 60),
        productName: str(o.productName, 200) ?? '',
        productCode: str(o.productCode, 60),
        qty: Math.max(0, Math.floor(Number(o.qty) || 0)),
        unitCostPaise: zeroRate ? 0 : Math.max(0, Math.round(Number(o.unitCostPaise) || 0)),
        lotNo: str(o.lotNo, 60),
        // No serials scanned: receive them as 'serials to follow' rather than refuse the delivery.
        ...(serials.length ? { capture: 'serials' as const, serials } : { capture: 'placeholders' as const }),
      };
    });
    if (!lines.length) throw new V1Error('Add at least one item.');
    const r = await receiveGoods(ctx.scope, {
      partyId,
      receivedDate: new Date(),
      supplierInvoiceNo: str(b.supplierInvoiceNo, 60),
      notes: str(b.notes, 1000) ?? 'Received on Vcare',
      lines,
    }, ctx.user.id);
    return { ok: true, ...r };
  });
}
