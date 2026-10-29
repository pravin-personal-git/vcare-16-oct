import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements } from './stock';
import { computeTotals } from '@/lib/quotation-totals';
import { postCogsMovement, reverseCogsMovement } from './cogs';
import { unitsOnRef } from './serial-links';
import {
  movesStock, returnableQty, validateReturn,
  type Disposition, type InvoiceLineForReturn, type ProposedReturnLine,
} from '@/lib/returns';

/**
 * Goods coming back.
 *
 * The physical half of a return, and only the physical half - the money is a
 * credit note, which is a separate document for the reasons set out on
 * `SalesReturn` in the schema.
 *
 * TWO RULES THE SERVER ENFORCES, NOT THE UI
 *
 * 1. **The cumulative cap.** More cannot come back than went out, counting
 *    every earlier live return. Computed on every read and re-checked inside
 *    the write transaction, because the browser's copy of "how many are left"
 *    is a snapshot that a colleague may have invalidated thirty seconds ago.
 *
 * 2. **Stock moves on receipt, never on draft, and only for good goods.** A
 *    draft is somebody typing. Damaged and scrapped items are recorded but not
 *    restocked - putting them back on the shelf is how a broken fan gets sold
 *    twice, which is the actual failure mode in the reference app, where there
 *    is no disposition field at all.
 *
 * Spec: _archive/roadmap/NEXT-SPRINT.md weeks 2–4
 */

export class ReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReturnError';
  }
}

/** A return that has been cancelled never happened, and frees its allowance. */
const LIVE_RETURN = { lifecycle: { not: 'cancelled' } } as const;

// ------------------------------------------------------------------ reading

export interface ReturnRow {
  id: string;
  returnNo: string;
  invoiceId: string;
  invoiceNo: string;
  /** The customer record, so the name opens their page (G-35). */
  partyId: string | null;
  customerName: string;
  returnedAt: Date;
  lifecycle: string;
  reason: string;
  lineCount: number;
  totalQty: number;
  /** Taxable value of the goods on this return, before GST. */
  valuePaise: number;
  restockQty: number;
  damagedQty: number;
  /** Credit notes raised against it - the derived answer to "was it credited?". */
  creditNotes: { id: string; creditNoteNo: string; lifecycle: string; grandTotalPaise: number }[];
  creditedPaise: number;
}

export async function listReturns(
  scope: StoreScope,
  opts: { invoiceId?: string; partyId?: string; lifecycle?: string } = {},
): Promise<ReturnRow[]> {
  const rows = await db.salesReturn.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : {}),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
      ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
    },
    orderBy: { returnedAt: 'desc' },
    select: {
      id: true, returnNo: true, invoiceId: true, customerName: true, partyId: true,
      returnedAt: true, lifecycle: true, reason: true,
      invoice: { select: { invoiceNo: true } },
      items: {
        select: {
          qty: true, disposition: true,
          invoiceLineQty: true, invoiceLineTaxablePaise: true,
        },
      },
      creditNotes: {
        select: { id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true },
        orderBy: { creditNoteDate: 'asc' },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    returnNo: r.returnNo,
    invoiceId: r.invoiceId,
    invoiceNo: r.invoice.invoiceNo,
    partyId: r.partyId,
    customerName: r.customerName,
    returnedAt: r.returnedAt,
    lifecycle: r.lifecycle,
    reason: r.reason,
    lineCount: r.items.length,
    totalQty: r.items.reduce((n, i) => n + i.qty, 0),
    // The stored proportion of the line, not a re-derivation: this is what the
    // credit note was or will be raised for, and the two must agree.
    valuePaise: r.items.reduce(
      (n, i) => n + (i.invoiceLineQty > 0
        ? Math.round((i.invoiceLineTaxablePaise * i.qty) / i.invoiceLineQty)
        : 0),
      0,
    ),
    restockQty: r.items.filter((i) => i.disposition === 'restock').reduce((n, i) => n + i.qty, 0),
    damagedQty: r.items.filter((i) => i.disposition !== 'restock').reduce((n, i) => n + i.qty, 0),
    creditNotes: r.creditNotes,
    creditedPaise: r.creditNotes
      .filter((c) => c.lifecycle === 'issued')
      .reduce((n, c) => n + c.grandTotalPaise, 0),
  }));
}

export interface InvoiceForReturn {
  id: string;
  invoiceNo: string;
  invoiceDate: Date;
  lifecycle: string;
  customerName: string;
  partyId: string | null;
  gstin: string | null;
  taxMode: string;
  grandTotalPaise: number;
  lines: InvoiceLineForReturn[];
  /** True when every line is fully returned. */
  fullyReturned: boolean;
}

/**
 * An invoice with the returnable quantity worked out for each line.
 *
 * The taxable value per line is RECOMPUTED here from the stored line figures
 * rather than read from a column, because `InvoiceItem` stores `lineTotalPaise`
 * *before* the order-level discount is apportioned. Crediting from that number
 * would refund a customer more than they were ever charged - on a 10% order
 * discount, 10% more, every time.
 */
export async function getInvoiceForReturn(
  scope: StoreScope,
  invoiceId: string,
): Promise<InvoiceForReturn | null> {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, ...scopeWhere(scope) },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, lifecycle: true,
      customerName: true, partyId: true, gstin: true, taxMode: true,
      grandTotalPaise: true, discountType: true, discountValue: true,
      deliveryCharge: true, deliveryExempt: true,
      items: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, productId: true, productName: true, productCode: true,
          hsnCode: true, qty: true, unitPricePaise: true,
          discountPct: true, taxRatePct: true,
        },
      },
    },
  });
  if (!inv) return null;

  // The same function the invoice's own totals were computed with, so the
  // apportionment matches to the paise. Reimplementing it here is how the two
  // drift.
  const totals = computeTotals(
    inv.items.map((i) => ({
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
    })),
    {
      /*
        All three, not two. A return against a no-GST invoice was being
        recorded as an intra-state one, which is what the credit note raised
        from it then used to refund tax that was never charged (8 Oct 2026).
      */
      taxMode: inv.taxMode === 'NONE' ? 'NONE' : inv.taxMode === 'IGST' ? 'IGST' : 'CGST_SGST',
      discountType: inv.discountType === 'percent' ? 'percent' : 'amount',
      discountValue: inv.discountValue,
      deliveryPaise: inv.deliveryCharge,
      deliveryExempt: inv.deliveryExempt,
    },
  );

  const returned = await returnedQtyByInvoiceItem(scope, inv.items.map((i) => i.id));

  const lines: InvoiceLineForReturn[] = inv.items.map((i, idx) => ({
    invoiceItemId: i.id,
    productId: i.productId,
    productName: i.productName,
    productCode: i.productCode,
    hsnCode: i.hsnCode,
    qty: i.qty,
    unitPricePaise: i.unitPricePaise,
    discountPct: Number(i.discountPct),
    taxRatePct: Number(i.taxRatePct),
    taxablePaise: totals.lines[idx]?.taxablePaise ?? 0,
    returnedQty: returned.get(i.id) ?? 0,
  }));

  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    lifecycle: inv.lifecycle,
    customerName: inv.customerName,
    partyId: inv.partyId,
    gstin: inv.gstin,
    taxMode: inv.taxMode,
    grandTotalPaise: inv.grandTotalPaise,
    lines,
    fullyReturned: lines.length > 0 && lines.every((l) => returnableQty(l) === 0),
  };
}

/**
 * How many of each invoice line have already come back.
 *
 * Summed from live return rows every time. Never a stored counter - a cancelled
 * return has to give its allowance back, and a counter would not, so a customer
 * whose return was voided by mistake could never return those goods again.
 */
export async function returnedQtyByInvoiceItem(
  scope: StoreScope,
  invoiceItemIds: string[],
): Promise<Map<string, number>> {
  if (invoiceItemIds.length === 0) return new Map();

  const rows = await db.salesReturnItem.groupBy({
    by: ['invoiceItemId'],
    where: {
      invoiceItemId: { in: invoiceItemIds },
      return: { ...scopeWhere(scope), ...LIVE_RETURN },
    },
    _sum: { qty: true },
  });

  return new Map(rows.map((r) => [r.invoiceItemId, r._sum.qty ?? 0]));
}

export interface ReturnDetail extends ReturnRow {
  gstin: string | null;
  partyId: string | null;
  notes: string | null;
  warehouseId: string | null;
  cancelReason: string | null;
  receivedAt: Date | null;
  taxMode: string;
  items: {
    id: string;
    srNo: number;
    invoiceItemId: string;
    productId: string | null;
    productName: string;
    productCode: string | null;
    hsnCode: string | null;
    qty: number;
    disposition: string;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
    invoiceLineQty: number;
    invoiceLineTaxablePaise: number;
    /** This return's share of the line - what a credit note would be raised for. */
    creditTaxablePaise: number;
    note: string | null;
  }[];
}

export async function getReturnDetail(
  scope: StoreScope,
  id: string,
): Promise<ReturnDetail | null> {
  const r = await db.salesReturn.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      invoice: { select: { invoiceNo: true, taxMode: true } },
      creditNotes: {
        select: { id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true },
        orderBy: { creditNoteDate: 'asc' },
      },
    },
  });
  if (!r) return null;

  const items = r.items.map((i) => ({
    id: i.id,
    srNo: i.srNo,
    invoiceItemId: i.invoiceItemId,
    productId: i.productId,
    productName: i.productName,
    productCode: i.productCode,
    hsnCode: i.hsnCode,
    qty: i.qty,
    disposition: i.disposition,
    unitPricePaise: i.unitPricePaise,
    discountPct: Number(i.discountPct),
    taxRatePct: Number(i.taxRatePct),
    invoiceLineQty: i.invoiceLineQty,
    invoiceLineTaxablePaise: i.invoiceLineTaxablePaise,
    creditTaxablePaise: i.invoiceLineQty > 0
      ? Math.round((i.invoiceLineTaxablePaise * i.qty) / i.invoiceLineQty)
      : 0,
    note: i.note,
  }));

  return {
    id: r.id,
    returnNo: r.returnNo,
    invoiceId: r.invoiceId,
    invoiceNo: r.invoice.invoiceNo,
    customerName: r.customerName,
    gstin: r.gstin,
    partyId: r.partyId,
    returnedAt: r.returnedAt,
    lifecycle: r.lifecycle,
    reason: r.reason,
    notes: r.notes,
    warehouseId: r.warehouseId,
    cancelReason: r.cancelReason,
    receivedAt: r.receivedAt,
    taxMode: r.invoice.taxMode,
    lineCount: items.length,
    totalQty: items.reduce((n, i) => n + i.qty, 0),
    valuePaise: items.reduce((n, i) => n + i.creditTaxablePaise, 0),
    restockQty: items.filter((i) => i.disposition === 'restock').reduce((n, i) => n + i.qty, 0),
    damagedQty: items.filter((i) => i.disposition !== 'restock').reduce((n, i) => n + i.qty, 0),
    creditNotes: r.creditNotes,
    creditedPaise: r.creditNotes
      .filter((c) => c.lifecycle === 'issued')
      .reduce((n, c) => n + c.grandTotalPaise, 0),
    items,
  };
}

// ------------------------------------------------------------------ writing

export interface CreateReturnInput {
  invoiceId: string;
  lines: ProposedReturnLine[];
  reason: string;
  returnedAt?: Date | null;
  warehouseId?: string | null;
  notes?: string | null;
  /**
   * Mark it received immediately, which moves stock. The common case at a
   * counter, where the goods are physically in hand as the document is typed.
   */
  receiveNow?: boolean;
}

export async function createReturn(
  scope: StoreScope,
  input: CreateReturnInput,
  userId: string,
): Promise<{ id: string; returnNo: string; movedStock: boolean }> {
  const storeId = scopeForWrite(scope);

  const invoice = await getInvoiceForReturn(scope, input.invoiceId);
  if (!invoice) throw new ReturnError('Invoice not found in your scope.');

  // A draft invoice has not been issued to anybody, so there is nothing to
  // send back. A cancelled one never was a supply.
  if (invoice.lifecycle !== 'sent') {
    throw new ReturnError(
      invoice.lifecycle === 'draft'
        ? `${invoice.invoiceNo} is still a draft. Issue it before recording a return against it.`
        : `${invoice.invoiceNo} has been cancelled, so nothing was supplied to return.`,
    );
  }

  const problems = validateReturn(input.lines, invoice.lines);
  if (problems.length > 0) throw new ReturnError(problems.join('\n'));

  const byId = new Map(invoice.lines.map((l) => [l.invoiceItemId, l]));

  // Merge duplicates the same way the validator did, so what is checked is what
  // is written.
  const merged = new Map<string, { qty: number; disposition: Disposition }>();
  for (const p of input.lines) {
    if (p.qty <= 0) continue;
    const prev = merged.get(p.invoiceItemId);
    merged.set(p.invoiceItemId, {
      qty: (prev?.qty ?? 0) + p.qty,
      disposition: p.disposition,
    });
  }

  const returnNo = await allocateDocumentNumber(storeId, 'SR', input.returnedAt ?? undefined);
  const receiving = input.receiveNow === true;

  const created = await db.$transaction(async (tx) => {
    // Re-check the cap inside the transaction against rows this transaction can
    // see. The browser's figures came from a read that may be minutes old, and
    // two people returning the last item of a line at once would otherwise both
    // succeed and put the invoice permanently over-returned.
    const live = await tx.salesReturnItem.groupBy({
      by: ['invoiceItemId'],
      where: {
        invoiceItemId: { in: [...merged.keys()] },
        return: { storeId, lifecycle: { not: 'cancelled' } },
      },
      _sum: { qty: true },
    });
    const already = new Map<string, number>(
      live.map((r) => [r.invoiceItemId, r._sum.qty ?? 0]),
    );

    for (const [invoiceItemId, { qty }] of merged) {
      const line = byId.get(invoiceItemId)!;
      const left = line.qty - (already.get(invoiceItemId) ?? 0);
      if (qty > left) {
        throw new ReturnError(
          `${line.productName}: only ${Math.max(0, left)} can still be returned.`
          + ' Somebody else recorded a return while this one was open - reopen the invoice and try again.',
        );
      }
    }

    const sr = await tx.salesReturn.create({
      data: {
        returnNo,
        storeId,
        invoiceId: invoice.id,
        partyId: invoice.partyId,
        customerName: invoice.customerName,
        gstin: invoice.gstin,
        returnedAt: input.returnedAt ?? new Date(),
        lifecycle: receiving ? 'received' : 'draft',
        reason: input.reason,
        warehouseId: input.warehouseId ?? null,
        notes: input.notes ?? null,
        receivedAt: receiving ? new Date() : null,
        receivedBy: receiving ? userId : null,
        createdBy: userId,
        items: {
          create: [...merged].map(([invoiceItemId, m], idx) => {
            const line = byId.get(invoiceItemId)!;
            return {
              srNo: idx + 1,
              invoiceItemId,
              productId: line.productId,
              productName: line.productName,
              productCode: line.productCode,
              hsnCode: line.hsnCode,
              qty: m.qty,
              disposition: m.disposition,
              unitPricePaise: line.unitPricePaise,
              discountPct: line.discountPct,
              taxRatePct: line.taxRatePct,
              invoiceLineQty: line.qty,
              invoiceLineTaxablePaise: line.taxablePaise,
            };
          }),
        },
      },
      include: { items: true },
    });

    if (receiving) {
      await moveStockForReturn(tx, storeId, userId, sr, sr.items, input.warehouseId ?? null);
    }

    return sr;
  });

  if (receiving) {
    await postReturnCogs(scope, created.id, returnNo, created.items, userId);
  }

  return { id: created.id, returnNo, movedStock: receiving };
}

/**
 * Mark the goods physically received. This is what moves stock.
 *
 * Separate from creating the document because the two genuinely happen apart:
 * a customer says on Monday that they are sending six units back, and the box
 * arrives on Thursday with five. Restocking on Monday would put stock on the
 * shelf that is still in a van.
 */
export async function receiveReturn(
  scope: StoreScope,
  id: string,
  userId: string,
): Promise<{ returnNo: string; restocked: number }> {
  const storeId = scopeForWrite(scope);

  const sr = await db.salesReturn.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { items: true },
  });
  if (!sr) throw new ReturnError('Return not found in your scope.');
  if (sr.lifecycle === 'cancelled') throw new ReturnError(`${sr.returnNo} has been cancelled.`);
  if (sr.lifecycle === 'received') throw new ReturnError(`${sr.returnNo} is already received.`);

  await db.$transaction(async (tx) => {
    // Guarded on the lifecycle that was read. Two people clicking Receive at
    // once would otherwise both move stock, doubling the restock.
    const updated = await tx.salesReturn.updateMany({
      where: { id, storeId, lifecycle: 'draft' },
      data: { lifecycle: 'received', receivedAt: new Date(), receivedBy: userId },
    });
    if (updated.count === 0) {
      throw new ReturnError('This return was received by somebody else a moment ago.');
    }

    await moveStockForReturn(tx, storeId, userId, sr, sr.items, sr.warehouseId);
  });

  // Posted AFTER the transaction, same reasoning as `issueCreditNote`: the
  // `updated.count === 0` check inside is what decides which of two
  // concurrent callers actually won the receive, and posting first could
  // let the loser post a COGS entry for a restock that was never theirs.
  await postReturnCogs(scope, sr.id, sr.returnNo, sr.items, userId);

  return {
    returnNo: sr.returnNo,
    restocked: sr.items
      .filter((i) => movesStock(i.disposition as Disposition))
      .reduce((n, i) => n + i.qty, 0),
  };
}

/** Debit Inventory / Credit COGS for whatever a return actually restocked - damaged and scrapped lines never moved stock, so they never move COGS either. */
async function postReturnCogs(
  scope: StoreScope,
  returnId: string,
  returnNo: string,
  items: { productId: string | null; qty: number; disposition: string }[],
  userId: string,
): Promise<void> {
  const lines = items
    .filter((i) => i.productId && movesStock(i.disposition as Disposition))
    .map((i) => ({ productId: i.productId as string, qty: i.qty }));
  if (lines.length === 0) return;

  await postCogsMovement(scope, {
    direction: 'in',
    entryDate: new Date(),
    description: `Return ${returnNo} restocked`,
    sourceId: returnId,
    lines,
  }, userId);
}

async function moveStockForReturn(
  tx: Prisma.TransactionClient,
  storeId: string,
  userId: string,
  sr: { id: string; returnNo: string; invoiceId: string; partyId: string | null },
  items: { productId: string | null; qty: number; disposition: string; productName: string }[],
  warehouseId: string | null,
): Promise<void> {
  const movements = items
    .filter((i) => i.productId && movesStock(i.disposition as Disposition))
    .map((i) => ({
      productId: i.productId!,
      qty: i.qty,                       // positive - stock coming back in
      reason: 'return_in' as const,
      refType: 'SalesReturn',
      refId: sr.id,
      refNo: sr.returnNo,
      warehouseId,
      // This customer's units off this invoice - never somebody else's (29 Oct 2026).
      returnFromInvoiceId: sr.invoiceId,
      partyId: sr.partyId,
    }));

  if (movements.length > 0) {
    await applyMovements(tx, storeId, userId, movements);
  }
}

/**
 * Withdraw a return.
 *
 * Reverses any stock it put back, with a compensating movement rather than by
 * deleting the original - the same rule the whole ledger runs on. The rows stay
 * so "restocked on the 3rd, cancelled on the 5th" is still readable, and the
 * cumulative cap frees up again because it filters on lifecycle.
 *
 * Refused once a credit note stands against it. Cancelling the goods half of a
 * return while the money half remains issued would leave a credit note citing a
 * return that officially never happened - which is precisely what an auditor
 * looks for.
 */
export async function cancelReturn(
  scope: StoreScope,
  id: string,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new ReturnError('Say why this return is being cancelled.');

  const sr = await db.salesReturn.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: true,
      creditNotes: { select: { creditNoteNo: true, lifecycle: true } },
    },
  });
  if (!sr) throw new ReturnError('Return not found in your scope.');
  if (sr.lifecycle === 'cancelled') throw new ReturnError(`${sr.returnNo} is already cancelled.`);

  const live = sr.creditNotes.filter((c) => c.lifecycle === 'issued');
  if (live.length > 0) {
    throw new ReturnError(
      `${live.map((c) => c.creditNoteNo).join(', ')} `
      + `${live.length === 1 ? 'has' : 'have'} been issued against this return.`
      + ' Cancel the credit note first - the goods and the money have to be withdrawn together.',
    );
  }

  // Reversed BEFORE the transaction - this undoes THIS return's own restock,
  // not a separate later event, so a real reversal is correct here (unlike
  // `postReturnCogs`, which posts a fresh entry because a return is its own
  // economic event against a possibly much older invoice). Safe even under
  // the same race the transaction below guards against: `reverseJournalEntry`
  // refuses a second reversal of the same entry on its own, so a losing
  // concurrent call fails cleanly here rather than double-reversing.
  if (sr.lifecycle === 'received') {
    await reverseCogsMovement(scope, sr.id, userId, `Return ${sr.returnNo} cancelled: ${reason.trim()}`);
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.salesReturn.updateMany({
      where: { id, storeId, lifecycle: { not: 'cancelled' } },
      data: { lifecycle: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
    if (updated.count === 0) return;

    // Only reverse what was actually put in. A draft never moved stock.
    if (sr.lifecycle === 'received') {
      // The exact units this return shelved go back to the customer and the bill;
      // with none named nothing is guessed (29 Oct 2026).
      const shelved = await unitsOnRef(tx, [storeId], { refType: 'SalesReturn', refId: sr.id }, ['in_stock', 'reserved']);
      const movements = sr.items
        .filter((i) => i.productId && movesStock(i.disposition as Disposition))
        .map((i) => {
          const ids = (shelved.get(i.productId!) ?? []).map((u) => u.id);
          return {
            productId: i.productId!,
            qty: -i.qty,
            reason: 'return_out' as const,
            refType: 'SalesReturn',
            refId: sr.id,
            refNo: sr.returnNo,
            note: `Return cancelled - ${reason.trim()}`,
            warehouseId: sr.warehouseId,
            ...(ids.length
              ? { unitDestination: 'customer' as const, stockUnitIds: ids, partyId: sr.partyId, invoiceId: sr.invoiceId }
              : { unitDestination: 'none' as const }),
          };
        });
      if (movements.length > 0) await applyMovements(tx, storeId, userId, movements);
    }
  });
}

/** Invoices a return can be raised against, for the picker. */
export async function listReturnableInvoices(scope: StoreScope, take = 200) {
  const invoices = await db.invoice.findMany({
    where: { ...scopeWhere(scope), lifecycle: 'sent' },
    orderBy: { invoiceDate: 'desc' },
    take,
    select: {
      id: true, invoiceNo: true, invoiceDate: true, customerName: true,
      grandTotalPaise: true,
      items: { select: { id: true, qty: true } },
    },
  });

  const returned = await returnedQtyByInvoiceItem(
    scope,
    invoices.flatMap((i) => i.items.map((x) => x.id)),
  );

  return invoices
    .map((i) => {
      const sold = i.items.reduce((n, x) => n + x.qty, 0);
      const back = i.items.reduce((n, x) => n + (returned.get(x.id) ?? 0), 0);
      return {
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate,
        customerName: i.customerName,
        grandTotalPaise: i.grandTotalPaise,
        soldQty: sold,
        returnedQty: back,
      };
    })
    // Nothing left to return is not an error, but it is noise in a picker.
    .filter((i) => i.returnedQty < i.soldQty);
}
