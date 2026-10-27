'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, newActionId } from '@/server/approval-actions';
import { db } from '@/server/db';
import {
  cancelBill, createBill, paySupplier, postBill, receiveBillGoods, reversePayment, unbilledReceipts,
  type BillGoods, type BillLineDraft,
} from '@/server/purchases';
import { scopeWhere } from '@/server/store-scope';
import type { SearchOption } from '@/components/ui/SearchSelect';
import { friendlyError } from '@/lib/friendly-error';

const WAIT = 'sent for approval - it takes effect once approved. Track it in My Desk';

/**
 * Server actions for purchase bills and supplier payments.
 *
 * TWO PERMISSIONS, NOT ONE.
 *
 * `purchase.edit` enters and posts a bill - which puts stock on the shelf and
 * creates a liability. `purchase.pay` sends money out of the bank. In a shop of
 * any size those are two people, and keeping them apart is the oldest control
 * in accounting: the person who says "these goods arrived" should not also be
 * the person who says "so pay for them".
 *
 * Folding them together would be one line shorter and would make that
 * separation impossible for a client to configure.
 */

export interface PurchaseState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

const CAN_EDIT = 'purchase.edit';
const CAN_PAY = 'purchase.pay';

async function log(
  storeId: string, userId: string, entityId: string, entityType: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType, entityId, amount, description } })
    .catch((e) => console.error('[purchases] audit write failed (non-fatal)', e));
}

async function guard(permission: string, what: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) {
    return { error: `You do not have permission to ${what}.` };
  }
  // Purchases write stock and money, and both belong to exactly one store.
  // `scopeForWrite` would throw here anyway; catching it first turns an
  // exception into a sentence.
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

function fail(e: unknown): PurchaseState {
  const message = friendlyError(e, true);
  return { error: message };
}

// -------------------------------------------------------------------- bills

export async function createBillAction(input: {
  partyId: string;
  supplierBillNo: string;
  billDate: string;
  dueDate: string;
  freightPaise: number;
  notes: string | null;
  lines: BillLineDraft[];
  post: boolean;
  /** Have the goods arrived? (28 Oct 2026) */
  goods?: BillGoods;
  grnIds?: string[];
}): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'enter purchase bills');
  if ('error' in g) return g;

  try {
    const result = await createBill(
      g.ctx.scope,
      {
        partyId: input.partyId,
        supplierBillNo: input.supplierBillNo,
        billDate: new Date(input.billDate),
        dueDate: new Date(input.dueDate),
        freightPaise: input.freightPaise,
        notes: input.notes,
        lines: input.lines,
        post: input.post,
        goods: input.goods,
        grnIds: input.grnIds,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, result.id, 'PurchaseBill', 'created',
      `Purchase bill ${result.billNo} entered`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');
    // Stock changed, so the products screen is stale too.
    if (input.post) revalidatePath('/products');

    return {
      ok: true,
      id: result.id,
      message: input.post && result.awaitingApproval
        ? `${result.billNo} saved and ${WAIT}.`
        : input.post
          ? input.goods === 'awaited'
            ? `${result.billNo} posted - goods awaited. Receive them on the bill when they arrive.`
            : input.goods === 'on_receipt'
              ? `${result.billNo} posted against the goods receipt - stock was already in.`
              : `${result.billNo} entered and posted. Stock is in.`
          : `${result.billNo} saved as a draft.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function postBillAction(billId: string): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'post purchase bills');
  if ('error' in g) return g;

  try {
    const posted = await postBill(g.ctx.scope, billId, g.ctx.user.id);
    if (posted.awaitingApproval) {
      revalidatePath('/purchase/bills');
      return { ok: true, message: `Not posted yet: ${WAIT}.` };
    }
    await log(g.storeId, g.ctx.user.id, billId, 'PurchaseBill', 'posted', 'Purchase bill posted');

    revalidatePath('/purchase/bills');
    revalidatePath(`/purchase/bills/${billId}`);
    revalidatePath('/purchase/payables');
    revalidatePath('/products');

    return { ok: true, message: 'Posted. Stock is in and the bill is now payable.' };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelBillAction(billId: string, reason: string): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'cancel purchase bills');
  if ('error' in g) return g;

  try {
    await cancelBill(g.ctx.scope, billId, reason, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, billId, 'PurchaseBill', 'cancelled',
      `Purchase bill cancelled: ${reason}`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath(`/purchase/bills/${billId}`);
    revalidatePath('/purchase/payables');
    revalidatePath('/products');

    return { ok: true, message: 'Cancelled. Stock has been taken back out.' };
  } catch (e) {
    return fail(e);
  }
}

// ----------------------------------------------------------------- payments

export async function paySupplierAction(input: {
  partyId: string;
  amountPaise: number;
  method: 'cash' | 'bank' | 'upi' | 'cheque' | 'adjustment';
  paidAt: string;
  reference: string | null;
  note: string | null;
  allocations?: { billId: string; amountPaise: number }[];
}): Promise<PurchaseState> {
  const g = await guard(CAN_PAY, 'pay suppliers');
  if ('error' in g) return g;

  try {
    {
      const sup = await db.party.findFirst({ where: { id: input.partyId, storeId: g.storeId }, select: { companyName: true, firstName: true, lastName: true } });
      const held = sup && await heldMessage(g.ctx.scope, g.ctx.user.id, {
        type: 'supplier_payment', entityId: newActionId(), amountPaise: input.amountPaise,
        title: `Pay supplier ${rupees(input.amountPaise)}`,
        summary: `${sup.companyName || [sup.firstName, sup.lastName].filter(Boolean).join(' ')} - ${input.method}`,
        payload: { ...input },
      });
      if (held) { revalidatePath('/purchase/payables'); return { ok: true, message: held }; }
    }
    const result = await paySupplier(
      g.ctx.scope,
      {
        partyId: input.partyId,
        amountPaise: input.amountPaise,
        method: input.method,
        paidAt: new Date(input.paidAt),
        reference: input.reference,
        note: input.note,
        allocations: input.allocations,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, result.id, 'SupplierPayment', 'paid',
      `Paid ${rupees(input.amountPaise)} - ${result.paymentNo}`,
      input.amountPaise,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');

    return {
      ok: true,
      id: result.id,
      message: result.unallocatedPaise > 0
        ? `${result.paymentNo} recorded. ${rupees(result.unallocatedPaise)} is on account `
          + 'as an advance - it is not lost, it just is not against a bill yet.'
        : `${result.paymentNo} recorded.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function reversePaymentAction(
  paymentId: string,
  reason: string,
): Promise<PurchaseState> {
  const g = await guard(CAN_PAY, 'reverse supplier payments');
  if ('error' in g) return g;

  try {
    {
      const pay = await db.supplierPayment.findFirst({ where: { id: paymentId, storeId: g.storeId }, select: { paymentNo: true, amountPaise: true } });
      const held = pay && await heldMessage(g.ctx.scope, g.ctx.user.id, {
        type: 'supplier_payment_reverse', entityId: paymentId, amountPaise: pay.amountPaise,
        title: `Reverse supplier payment ${pay.paymentNo} ${rupees(pay.amountPaise)}`, summary: reason,
        payload: { reason },
      });
      if (held) { revalidatePath('/purchase/payables'); return { ok: true, message: held }; }
    }
    await reversePayment(g.ctx.scope, paymentId, reason, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, paymentId, 'SupplierPayment', 'reversed',
      `Payment reversed: ${reason}`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');

    return { ok: true, message: 'Reversed. The bills it was paying are open again.' };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------- the bill form (28 Oct 2026)

/** A supplier for the bill's search box - suppliers first, any party (the shop next door is both). */
export interface SupplierPick extends SearchOption { isSupplier: boolean }

export async function searchSuppliersAction(q: string): Promise<SupplierPick[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const like = { contains: s, mode: 'insensitive' as const };
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(ctx.scope), status: 'active',
      ...(s ? { OR: [{ companyName: like }, { firstName: like }, { lastName: like }, { phone: { contains: s } }, { gstin: like }, { partyCode: like }] } : { isSupplier: true }),
    },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true, phone: true, gstin: true, city: true, isSupplier: true },
    orderBy: [{ isSupplier: 'desc' }, { companyName: 'asc' }, { firstName: 'asc' }],
    take: 20,
  });
  return rows.map((p) => ({
    id: p.id,
    label: p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
    sub: [p.isSupplier ? null : 'customer', p.phone, p.gstin, p.city].filter(Boolean).join(' · '),
    isSupplier: p.isSupplier,
  }));
}

/** A new supplier from the bill form, in three fields. Same phone already on file: that party. */
export async function quickAddSupplierAction(input: { name: string; phone: string; gstin: string | null }): Promise<{ error?: string; supplier?: SupplierPick }> {
  const g = await guard(CAN_EDIT, 'enter purchase bills');
  if ('error' in g) return { error: g.error };
  const name = input.name.trim();
  const phone = input.phone.replace(/\D/g, '').slice(-10);
  if (!name) return { error: 'Type the supplier\u2019s name.' };
  if (phone.length !== 10) return { error: 'Type a 10-digit phone number.' };
  const existing = await db.party.findFirst({
    where: { storeId: g.storeId, phone },
    select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, gstin: true, isSupplier: true },
  });
  if (existing) {
    if (!existing.isSupplier) await db.party.update({ where: { id: existing.id }, data: { isSupplier: true } });
    return { supplier: { id: existing.id, label: existing.companyName || [existing.firstName, existing.lastName].filter(Boolean).join(' '), sub: [existing.phone, existing.gstin].filter(Boolean).join(' · '), isSupplier: true } };
  }
  try {
    const { createParty } = await import('@/server/parties');
    const { party } = await createParty(g.ctx.scope, {
      isCustomer: false, isSupplier: true, supplierType: null, paymentTermsDays: 0,
      companyName: name, gstin: input.gstin?.trim().toUpperCase() || null, title: null, firstName: name, lastName: null,
      designation: null, phone, altPhone: null, email: null, website: null, customerTypeId: null, source: null,
      birthday: null, weddingAnniversary: null, addressLine1: null, state: null, city: null, pincode: null,
      deliveryAddress: null, deliverySameAsBilling: true, creditLimitPaise: 0, creditLimitDays: 0, subscribeSms: false,
    });
    await log(g.storeId, g.ctx.user.id, party.id, 'Party', 'Create', `Supplier '${name}' added from a purchase bill (${party.partyCode})`);
    return { supplier: { id: party.id, label: name, sub: [phone, input.gstin].filter(Boolean).join(' · '), isSupplier: true } };
  } catch (e) {
    return { error: fail(e).error };
  }
}

/** A product for a bill line: what the line needs to fill itself in. */
export interface BillProductPick extends SearchOption {
  code: string; hsnCode: string | null; kind: string; unit: string; serial: boolean; lastCostPaise: number | null; taxRatePct: number | null;
}

export async function searchBillProductsAction(q: string): Promise<BillProductPick[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const like = { contains: s, mode: 'insensitive' as const };
  const rows = await db.product.findMany({
    where: { ...scopeWhere(ctx.scope), isActive: true, ...(s ? { OR: [{ productName: like }, { productCode: like }, { barcode: like }] } : {}) },
    select: {
      id: true, productName: true, productCode: true, hsnCode: true, sacCode: true, kind: true, unit: true, trackingMode: true,
      prices: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { taxRatePct: true } },
      purchasePrices: { orderBy: { purchasedAt: 'desc' }, take: 1, select: { unitCostPaise: true } },
    },
    orderBy: { productName: 'asc' },
    take: 20,
  });
  return rows.map((p) => ({
    id: p.id, label: p.productName,
    sub: [p.productCode, p.trackingMode === 'serial' ? 'serial numbers' : null, p.unit].filter(Boolean).join(' · '),
    code: p.productCode, hsnCode: p.hsnCode ?? p.sacCode, kind: p.kind, unit: p.unit, serial: p.trackingMode === 'serial',
    lastCostPaise: p.purchasePrices[0]?.unitCostPaise ?? null,
    taxRatePct: p.prices[0] ? Number(p.prices[0].taxRatePct) : null,
  }));
}

/** What a supplier has that this bill could be against: receipts not yet billed, open purchase orders. */
export async function billSourcesAction(partyId: string) {
  const ctx = await requireContext();
  const [receipts, orders] = await Promise.all([
    unbilledReceipts(ctx.scope, partyId),
    db.purchaseOrder.findMany({
      where: { ...scopeWhere(ctx.scope), partyId, status: { in: ['sent', 'approved', 'partially_received'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, orderNo: true, createdAt: true,
        items: { orderBy: { srNo: 'asc' }, select: { productId: true, productName: true, productCode: true, qty: true, receivedQty: true, unitCostPaise: true, taxRatePct: true } },
      },
    }),
  ]);
  // Which products need serials - so a line filled from an order shows its serial box.
  const ids = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)).filter((x): x is string => !!x))];
  const serialIds = new Set((ids.length ? await db.product.findMany({ where: { id: { in: ids }, trackingMode: 'serial' }, select: { id: true } }) : []).map((p) => p.id));
  return JSON.parse(JSON.stringify({
    receipts,
    orders: orders.map((o) => ({
      id: o.id, no: o.orderNo, at: o.createdAt,
      items: o.items.map((i) => ({ ...i, taxRatePct: Number(i.taxRatePct), serial: !!i.productId && serialIds.has(i.productId) })),
    })),
  })) as {
    receipts: Awaited<ReturnType<typeof unbilledReceipts>>;
    orders: { id: string; no: string; at: string; items: { productId: string | null; productName: string; productCode: string | null; qty: number; receivedQty: number; unitCostPaise: number; taxRatePct: number; serial: boolean }[] }[];
  };
}

/** The goods of an awaited bill arrive: received against it, with serials. */
export async function receiveBillGoodsAction(billId: string, serialsByItem: Record<string, string[]>): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'receive goods');
  if ('error' in g) return g;
  try {
    const r = await receiveBillGoods(g.ctx.scope, billId, serialsByItem, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, billId, 'PurchaseBill', 'received', `Goods received against the bill${r.grnNo ? ` on ${r.grnNo}` : ''}`);
    revalidatePath(`/purchase/bills/${billId}`);
    revalidatePath('/purchase/bills');
    revalidatePath('/goods-receipt');
    revalidatePath('/products');
    return { ok: true, message: r.grnNo ? `Received on ${r.grnNo}. Stock is in.` : 'Received.' };
  } catch (e) {
    return fail(e);
  }
}
