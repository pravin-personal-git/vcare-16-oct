'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { stockReport } from '@/server/stock-report';
import { createPurchaseOrder } from '@/server/purchase-orders';
import { friendlyError } from '@/lib/friendly-error';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

type Result = { ok: true; message: string } | { error: string };

/**
 * "Make PO" on the Stock and Business dashboards (11 Oct 2026): one draft
 * purchase order per supplier for the products ticked, each line at the
 * product's re-order quantity (or enough to reach twice its re-order level)
 * and the price it was last bought at. Drafts - somebody still checks and
 * sends them; nothing is ordered behind anybody's back.
 */
export async function makeReorderPoAction(productIds: string[]): Promise<Result> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('purchase.edit')) return { error: 'Making purchase orders needs the Purchase edit permission.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). A purchase order belongs to one branch.' };
    const ids = [...new Set(productIds)].slice(0, 60);
    if (!ids.length) return { error: 'Tick at least one product.' };

    const report = await stockReport(ctx.scope);
    const rows = new Map(report.rows.map((r) => [r.productId, r]));
    const balances = await db.productBalance.findMany({ where: { productId: { in: ids } }, select: { productId: true, reorderQty: true } });
    const reorderQty = new Map<string, number>();
    for (const b of balances) reorderQty.set(b.productId, Math.max(reorderQty.get(b.productId) ?? 0, b.reorderQty));
    const lastBought = await db.purchaseBillItem.findMany({
      where: { productId: { in: ids }, bill: { ...scopeWhere(ctx.scope), lifecycle: 'received' } },
      orderBy: { bill: { billDate: 'desc' } },
      select: { productId: true, unitCostPaise: true, taxRatePct: true, bill: { select: { partyId: true } } },
      take: LIST_MAX_ROWS,
    });
    const last = new Map<string, (typeof lastBought)[number]>();
    for (const b of lastBought) if (b.productId && !last.has(b.productId)) last.set(b.productId, b);

    const bySupplier = new Map<string, string[]>();
    const noSupplier: string[] = [];
    for (const id of ids) {
      const l = last.get(id);
      if (!l) { noSupplier.push(rows.get(id)?.productName ?? id); continue; }
      bySupplier.set(l.bill.partyId, [...(bySupplier.get(l.bill.partyId) ?? []), id]);
    }
    if (!bySupplier.size) return { error: `None of these has been bought before, so there is no supplier to order from: ${noSupplier.slice(0, 3).join(', ')}. Make the order from Purchase › Purchase Order.` };

    const made: string[] = [];
    for (const [partyId, pids] of bySupplier) {
      const po = await createPurchaseOrder(ctx.scope, {
        partyId,
        orderDate: new Date(),
        notes: 'Made from the dashboard re-order list.',
        lines: pids.map((id) => {
          const r = rows.get(id); const l = last.get(id)!;
          const want = reorderQty.get(id) || Math.max(1, (r?.reorderLevel ?? 1) * 2 - Math.max(0, r?.qty ?? 0));
          return {
            productId: id, productName: r?.productName ?? 'Product', productCode: r?.productCode ?? null,
            qty: want, unitCostPaise: l.unitCostPaise, discountPct: 0, taxRatePct: Number(l.taxRatePct),
          };
        }),
      }, ctx.user.id);
      made.push(po.orderNo);
    }
    revalidatePath('/purchase/orders');
    return {
      ok: true,
      message: `${made.join(', ')} saved as draft${made.length > 1 ? 's' : ''}.${noSupplier.length ? ` Left out (never bought before): ${noSupplier.slice(0, 3).join(', ')}${noSupplier.length > 3 ? '…' : ''}.` : ''}`,
    };
  } catch (e) {
    return { error: friendlyError(e, true) };
  }
}

/** "Lost" on Quotations to chase: rejected, with the reason kept. */
export async function markQuotationLostAction(id: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.edit')) return { error: 'Changing a quotation needs the quotation edit permission.' };
    const why = reason.trim();
    if (!why) return { error: 'Say why it was lost.' };
    const q = await db.quotation.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { id: true, status: true, quotationNo: true } });
    if (!q) return { error: 'Quotation not found in your branch.' };
    if (q.status !== 'sent' && q.status !== 'draft') return { error: `${q.quotationNo} is already ${q.status}.` };
    await db.quotation.update({ where: { id }, data: { status: 'rejected', rejectedAt: new Date(), lostReason: why.slice(0, 500) } });
    revalidatePath('/quotation');
    revalidatePath('/dashboard');
    return { ok: true, message: `${q.quotationNo} marked lost.` };
  } catch (e) {
    return { error: friendlyError(e, true) };
  }
}
