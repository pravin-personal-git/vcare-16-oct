import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements } from './stock';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { planReceiptLine, type CaptureMode } from '@/lib/stock-intake';
import { completeLineSerials } from '@/lib/house-tag';
import { deriveExpiry } from '@/lib/expiry-policy';
import { unlinkedLinesError } from '@/lib/receipt-safety';

/**
 * Goods Receipt Note - RULE 2 (D011 decision log): the one thing that may
 * increase inventory QUANTITY. `PurchaseBill.postBill` posts the financial
 * entry (Inventory value, GST, Accounts Payable) and stops there; the
 * physical movement happens here, or on the receipt `postBill` creates and
 * posts for itself behind a bill with no PO - see `receiveDirectlyForBill`.
 *
 * Deliberately NOT a three-way match. A GRN entered by hand exists mainly to
 * receive against a `PurchaseOrder` with partial deliveries; there is no
 * workflow yet where goods and their bill arrive at different times, so
 * there is nothing here to reconcile against a GRNI clearing account. See
 * the model comment in schema.prisma and PLATFORM-COMPLETION.md.
 */

export class GrnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrnError';
  }
}

function partyDisplayName(p: {
  title?: string | null;
  firstName: string;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (p.companyName?.trim()) return p.companyName.trim();
  return [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

export interface GrnLineDraft {
  purchaseOrderItemId?: string | null;
  productId?: string | null;
  productName: string;
  productCode?: string | null;
  qty: number;
  /** Excluding tax. */
  unitCostPaise: number;

  /** GST on the supplier's bill for this line, as the bill states it. */
  taxRatePct?: number | null;
  /** The SUPPLIER'S warranty to us, in months from arrival. */
  warrantyMonths?: number | null;
  isRefurbished?: boolean;
  /** For a `batch` product. */
  lotNo?: string | null;
  mfgDate?: Date | null;
  expiryDate?: Date | null;

  /**
   * For a `serial` product: how its units were captured, and the serials
   * themselves. Not stored on the line - they become `StockUnit` rows when the
   * receipt posts. See lib/stock-intake `planReceiptLine` for the rules.
   */
  capture?: CaptureMode;
  serials?: string[];
  /** Serial products: boxes with no readable serial - house tags at posting (G4). */
  noSerial?: number;
}

export interface CreateGrnInput {
  purchaseOrderId?: string | null;
  partyId: string;
  receivedDate: Date;
  /** The supplier's own invoice number for this delivery. */
  supplierInvoiceNo?: string | null;
  notes?: string | null;
  lines: GrnLineDraft[];
}

function validateLines(lines: GrnLineDraft[]) {
  if (lines.length === 0) throw new GrnError('A goods receipt needs at least one line.');
  if (lines.some((l) => !l.productName.trim())) throw new GrnError('Every line needs a description.');
  if (lines.some((l) => l.qty <= 0)) throw new GrnError('Quantity must be more than zero on every line.');
}

export async function createGrn(
  scope: StoreScope,
  input: CreateGrnInput,
  userId: string,
): Promise<{ id: string; grnNo: string }> {
  const storeId = scopeForWrite(scope);
  validateLines(input.lines);

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true, isSupplier: true },
  });
  if (!party) throw new GrnError('Supplier not found in your scope.');

  if (input.purchaseOrderId) {
    const po = await db.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, ...scopeWhere(scope) },
      select: { id: true, status: true },
    });
    if (!po) throw new GrnError('Purchase order not found in your scope.');
    if (po.status === 'cancelled') throw new GrnError('That purchase order was cancelled.');
  }

  const grnNo = await allocateDocumentNumber(storeId, 'GRN', input.receivedDate);
  const supplierName = partyDisplayName(party);

  const grn = await db.$transaction(async (tx) => {
    const created = await tx.goodsReceiptNote.create({
      data: {
        storeId,
        grnNo,
        purchaseOrderId: input.purchaseOrderId ?? null,
        partyId: party.id,
        supplierName,
        receivedDate: input.receivedDate,
        supplierInvoiceNo: input.supplierInvoiceNo?.trim() || null,
        status: 'draft',
        notes: input.notes ?? null,
        createdBy: userId,
      },
    });

    await tx.goodsReceiptNoteItem.createMany({
      data: input.lines.map((l, i) => ({
        storeId,
        grnId: created.id,
        purchaseOrderItemId: l.purchaseOrderItemId ?? null,
        srNo: i + 1,
        productId: l.productId ?? null,
        productName: l.productName.trim(),
        productCode: l.productCode ?? null,
        qty: l.qty,
        unitCostPaise: l.unitCostPaise,
        taxRatePct: l.taxRatePct ?? null,
        warrantyMonths: l.warrantyMonths ?? null,
        isRefurbished: l.isRefurbished ?? false,
        lotNo: l.lotNo?.trim() || null,
        mfgDate: l.mfgDate ?? null,
        expiryDate: l.expiryDate ?? null,
      })),
    });

    if (!party.isSupplier) {
      await tx.party.update({ where: { id: party.id }, data: { isSupplier: true } });
    }

    return created;
  });

  return { id: grn.id, grnNo };
}

/**
 * Recomputes a PO's status from what its items have actually received.
 * Called after both a receipt and a cancellation, so it has to be able to
 * move backwards too - a cancelled GRN can take a PO from `partially_received`
 * back to `approved`, not just forward.
 */
async function syncPurchaseOrderStatus(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<void> {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { qty: true, receivedQty: true },
  });
  const allReceived = items.length > 0 && items.every((i) => i.receivedQty >= i.qty);
  const anyReceived = items.some((i) => i.receivedQty > 0);
  const status = allReceived ? 'received' : anyReceived ? 'partially_received' : 'approved';

  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
}


/**
 * The units a receipt line should create, keyed by the line's `srNo`: a
 * serial each, or null for a placeholder. Built by `receiveGoods` from the
 * serials a person scanned or pasted, and absent for a receipt this app made
 * for itself behind a bill - those arrive count-only, and the unit screen
 * shows them as serials still to record.
 */
export type LineUnits = Map<number, (string | null)[]>;

/**
 * Move a draft GRN to `posted`: stock in, and - for a GRN a person actually
 * filled in, not one this app created for itself behind a bill - a cost
 * history row. An auto-created receipt skips that: the bill it stands behind
 * already writes a better one (landed cost, freight apportioned), and two
 * cost rows for the same physical delivery would double-weight it under an
 * averaging cost method.
 *
 * WHAT A LINE CREATES DEPENDS ON THE PRODUCT'S `trackingMode`:
 *
 *   none      nothing - `applyMovements` skips it whatever this passes
 *   quantity  one movement, as before
 *   batch     the lot (created, or topped up if that lot number already
 *             exists) and a movement naming it. A line with no lot number -
 *             only possible on a receipt auto-created behind a bill - takes
 *             the receipt number as its lot, which is exactly what it is: one
 *             delivery.
 *   serial    one movement for the line's quantity, plus EXACTLY `item.qty`
 *             `StockUnit` rows - see Rule 1 below. Same transaction, so the
 *             units and the count cannot land without each other.
 *
 * RULE 1, ADDED 2 OCT 2026 - ONE UNIT PER ITEM RECEIVED, ALWAYS.
 *
 * This used to create one unit per serial the clerk typed, and refused only
 * the case of too MANY (`units.length > item.qty`). Too few was accepted
 * silently: ten cameras in, three serials typed, ten added to the shelf and
 * three to the identity ledger. Seven items existed that Atlas could not name,
 * and no report compared the two numbers, so nobody found out.
 *
 * Measured before the fix: 91 of 321 serial-tracked products disagreed with
 * themselves, roughly 39,000 items between them. This is where almost all of
 * it came from.
 *
 * Now every item gets a unit. A typed serial is the identity
 * (`identitySource: 'vendor'`); a blank slot gets a house tag Atlas issues and
 * the clerk sticks on (`identitySource: 'house'`). Nothing is refused that was
 * accepted before - a clerk with no serials to read receives exactly as fast
 * as they did yesterday - but the two ledgers now agree BY CONSTRUCTION rather
 * than by hope. See lib/house-tag.
 *
 * EXPIRY, ALSO 2 OCT 2026. A product marked `tracksExpiry` whose line carries
 * no date gets one derived from `shelfLifeDays`. The column was always there
 * and was never filled in unless somebody typed it; a shop that knows its
 * bread keeps four days should not retype that on every delivery.
 */
export async function postGrn(
  scope: StoreScope,
  grnId: string,
  userId: string,
  lineUnits: LineUnits = new Map(),
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const grn = await db.goodsReceiptNote.findFirst({
    where: { id: grnId, ...scopeWhere(scope) },
    select: {
      id: true, grnNo: true, status: true, purchaseOrderId: true, partyId: true,
      supplierName: true, receivedDate: true, sourceBillId: true,
      items: { orderBy: { srNo: 'asc' } },
    },
  });
  if (!grn) throw new GrnError('Goods receipt not found in your scope.');
  if (grn.status === 'posted') return; // idempotent
  if (grn.status === 'cancelled') throw new GrnError(`${grn.grnNo} was cancelled and cannot be posted.`);

  const stockItems = grn.items.filter((i) => i.productId);
  const products = new Map(
    (await db.product.findMany({
      where: { id: { in: stockItems.map((i) => i.productId!) }, ...scopeWhere(scope) },
      select: {
        id: true, productCode: true, trackingMode: true,
        tracksExpiry: true, shelfLifeDays: true,
      },
    })).map((p) => [p.id, p]),
  );

  /**
   * Every serial each serial-tracked product on this receipt already holds.
   *
   * Read ONCE, before the transaction, so house-tag numbering continues from
   * the right place without a query per line. The unique index on
   * `(storeId, productId, serialNo)` is still the guarantee - this only keeps
   * the numbers tidy and sequential.
   */
  const serialProductIds = stockItems
    .filter((i) => products.get(i.productId!)?.trackingMode === 'serial')
    .map((i) => i.productId!);
  const existingByProduct = new Map<string, (string | null)[]>();
  if (serialProductIds.length > 0) {
    const rows = await db.stockUnit.findMany({
      where: { storeId, productId: { in: serialProductIds } },
      select: { productId: true, serialNo: true },
    });
    for (const r of rows) {
      const list = existingByProduct.get(r.productId) ?? [];
      list.push(r.serialNo);
      existingByProduct.set(r.productId, list);
    }
  }

  await db.$transaction(async (tx) => {
    for (const item of stockItems) {
      const product = products.get(item.productId!);
      const mode = product?.trackingMode ?? 'quantity';
      let lotId: string | null = null;

      /**
       * The expiry date for this delivery.
       *
       * What the clerk typed wins, always - the pack is in their hand. Only
       * where they typed nothing does the product's shelf life fill it in, and
       * only for a product somebody marked as expiring. A product with no shelf
       * life on file and no typed date stays null, because a guessed expiry is
       * worse than none: a reminder fires on it and good stock is thrown away.
       */
      const expiryDate = item.expiryDate
        ?? (product?.tracksExpiry
          ? deriveExpiry(grn.receivedDate, product.shelfLifeDays)
          : null);
      if (expiryDate && !item.expiryDate) {
        await tx.goodsReceiptNoteItem.update({
          where: { id: item.id },
          data: { expiryDate },
        });
      }

      if (mode === 'batch') {
        const lotNo = item.lotNo?.trim() || grn.grnNo;
        const existing = await tx.stockLot.findFirst({
          where: { storeId, productId: item.productId!, lotNo },
          select: { id: true },
        });
        lotId = existing?.id ?? (await tx.stockLot.create({
          data: {
            storeId,
            productId: item.productId!,
            lotNo,
            grnItemId: item.id,
            unitCostPaise: item.unitCostPaise,
            mfgDate: item.mfgDate,
            expiryDate,
            receivedAt: grn.receivedDate,
            createdBy: userId,
          },
          select: { id: true },
        })).id;
      }

      await applyMovements(tx, storeId, userId, [{
        productId: item.productId!,
        qty: item.qty,
        reason: 'receipt',
        refType: 'GoodsReceiptNote',
        refId: grn.id,
        refNo: grn.grnNo,
        lotId,
      }]);

      if (mode === 'serial') {
        const typed = lineUnits.get(item.srNo) ?? [];
        if (typed.length > item.qty) {
          throw new GrnError(`${item.productName}: ${typed.length} units for ${item.qty} received.`);
        }

        // RULE 1: one unit per item received. Blank slots get a house tag.
        const identities = completeLineSerials({
          productCode: product?.productCode ?? item.productCode ?? 'ITEM',
          qty: item.qty,
          typed,
          at: grn.receivedDate,
          existingSerials: existingByProduct.get(item.productId!) ?? [],
        });

        // Keep the in-memory list current so a second line of the SAME product
        // on this receipt does not re-issue the tags the first line just took.
        const seen = existingByProduct.get(item.productId!) ?? [];
        existingByProduct.set(item.productId!, [...seen, ...identities.map((i) => i.serialNo)]);

        const created = await tx.stockUnit.createManyAndReturn({
          data: identities.map((i) => ({
            storeId,
            productId: item.productId!,
            serialNo: i.serialNo,
            identitySource: i.identitySource,
            status: 'in_stock',
            condition: item.isRefurbished ? 'refurbished' : 'new',
            grnItemId: item.id,
            unitCostPaise: item.unitCostPaise,
            receivedAt: grn.receivedDate,
            createdBy: userId,
          })),
          select: { id: true, serialNo: true, identitySource: true },
        });
        await tx.stockUnitEvent.createMany({
          data: created.map((u) => ({
            storeId,
            unitId: u.id,
            eventType: 'received',
            toStatus: 'in_stock',
            toCondition: item.isRefurbished ? 'refurbished' : 'new',
            partyId: grn.partyId,
            refType: 'GoodsReceiptNote',
            refId: grn.id,
            refNo: grn.grnNo,
            // Said in the unit's own history, so a year later nobody has to
            // guess whether that number came off the box or out of Atlas.
            note: u.identitySource === 'house'
              ? 'No serial on the item - Atlas issued this number. Print the label and stick it on.'
              : null,
            createdBy: userId,
          })),
        });
      }
    }

    if (!grn.sourceBillId && stockItems.length > 0) {
      await tx.productPurchasePrice.createMany({
        data: stockItems.map((i) => ({
          storeId,
          productId: i.productId!,
          unitCostPaise: i.unitCostPaise,
          qty: i.qty,
          purchasedAt: grn.receivedDate,
          supplierId: grn.partyId,
          reference: grn.grnNo,
          source: 'grn',
          createdBy: userId,
        })),
      });
    }

    if (grn.purchaseOrderId) {
      for (const item of grn.items) {
        if (!item.purchaseOrderItemId) continue;
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: { receivedQty: { increment: item.qty } },
        });
      }
      await syncPurchaseOrderStatus(tx, grn.purchaseOrderId);
    }

    await tx.goodsReceiptNote.update({ where: { id: grn.id }, data: { status: 'posted' } });
  });
}

/**
 * Receive goods in one step - plan every line, refuse anything wrong before a
 * number is used, then create and post.
 *
 * This is the path a person takes at the door. Serials are checked twice
 * before anything is written: against each other (lib/stock-intake) and
 * against units already in the store, case-insensitively, because a scanner
 * and a person typing the same label disagree on case and it is still one
 * camera.
 *
 * If posting fails after the draft is created - a serial taken by a
 * simultaneous receipt, say - the draft is cancelled with the reason rather
 * than left lying about looking like a receipt that is waiting for somebody.
 */
export async function receiveGoods(
  scope: StoreScope,
  input: CreateGrnInput,
  userId: string,
): Promise<{ id: string; grnNo: string; warnings: string[] }> {
  const storeId = scopeForWrite(scope);
  validateLines(input.lines);
  // G1 (12 Oct 2026): a line with no product would post and add no stock,
  // silently. Refused here, so the website and the phone both stop at it.
  const unlinked = unlinkedLinesError(input.lines);
  if (unlinked) throw new GrnError(unlinked);

  const ids = [...new Set(input.lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const products = new Map(
    (await db.product.findMany({
      where: { id: { in: ids }, ...scopeWhere(scope) },
      select: { id: true, productName: true, trackingMode: true },
    })).map((p) => [p.id, p]),
  );

  const lineUnits: LineUnits = new Map();
  const warnings: string[] = [];
  const lines = input.lines.map((l) => ({ ...l }));

  lines.forEach((l, i) => {
    if (!l.productId) return;
    const p = products.get(l.productId);
    if (!p) throw new GrnError(`${l.productName} is not a product in this store.`);
    const plan = planReceiptLine({
      productName: p.productName,
      trackingMode: p.trackingMode,
      qty: l.qty,
      capture: l.capture,
      serials: l.serials,
      noSerial: l.noSerial,
      lotNo: l.lotNo,
      expiryDate: l.expiryDate,
    });
    if (!plan.ok) throw new GrnError(plan.reason);
    if (plan.warning && plan.movesStock) warnings.push(plan.warning);
    if (plan.units.length > 0) lineUnits.set(i + 1, plan.units);
    if (plan.lotNo) l.lotNo = plan.lotNo;
  });

  // Across lines, and against units already on file.
  const wanted: { productId: string; serial: string }[] = [];
  lines.forEach((l, i) => {
    for (const s of lineUnits.get(i + 1) ?? []) if (s) wanted.push({ productId: l.productId!, serial: s });
  });
  const seen = new Set<string>();
  for (const w of wanted) {
    const key = `${w.productId}|${w.serial.toUpperCase()}`;
    if (seen.has(key)) throw new GrnError(`Serial ${w.serial} is on this receipt twice.`);
    seen.add(key);
  }
  const taken = await serialsAlreadyOnFile(storeId, wanted);
  if (taken.length > 0) {
    throw new GrnError(
      `Already on file: ${taken.slice(0, 5).join(', ')}`
      + `${taken.length > 5 ? ` and ${taken.length - 5} more` : ''}. A serial can only arrive once.`,
    );
  }

  const created = await createGrn(scope, { ...input, lines }, userId);
  try {
    await postGrn(scope, created.id, userId, lineUnits);
  } catch (err) {
    await cancelGrn(scope, created.id, userId, `Posting failed: ${(err as Error).message}`)
      .catch((e) => console.error('[goods-receipt] could not cancel failed draft', e));
    throw err;
  }
  return { ...created, warnings };
}

/**
 * Link a line of an already-posted receipt to its product, and put its stock
 * in now (G1, 12 Oct 2026). For the receipts posted before the block, whose
 * text-only lines never reached the shelf - the stock Pravin found missing.
 *
 * Moves what the line would have moved at posting, dated today in the stock
 * ledger with the receipt as its reference: quantity, a lot named after the
 * receipt for a batch product, and for a serial product one unit per item
 * with the serial still blank ("serials to follow") - the serials are on the
 * boxes and are filled in from the unit screen.
 */
export async function linkGrnLine(
  scope: StoreScope,
  grnItemId: string,
  productId: string,
  userId: string,
): Promise<{ grnNo: string; productName: string; qty: number; trackingMode: string }> {
  const storeId = scopeForWrite(scope);
  const item = await db.goodsReceiptNoteItem.findFirst({
    where: { id: grnItemId, ...scopeWhere(scope) },
    select: {
      id: true, qty: true, productId: true, productName: true, unitCostPaise: true, isRefurbished: true,
      lotNo: true, mfgDate: true, expiryDate: true,
      grn: { select: { id: true, grnNo: true, status: true, partyId: true, receivedDate: true, sourceBillId: true } },
    },
  });
  if (!item) throw new GrnError('That receipt line was not found in your scope.');
  if (item.productId) throw new GrnError('That line is already linked to a product.');
  if (item.grn.status !== 'posted') throw new GrnError(`${item.grn.grnNo} is ${item.grn.status}; only a posted receipt's lines can be linked.`);
  const product = await db.product.findFirst({
    where: { id: productId, ...scopeWhere(scope) },
    select: { id: true, productCode: true, productName: true, trackingMode: true },
  });
  if (!product) throw new GrnError('That product is not in this store.');
  const mode = product.trackingMode;
  const grn = item.grn;

  await db.$transaction(async (tx) => {
    await tx.goodsReceiptNoteItem.update({
      where: { id: item.id },
      data: { productId: product.id, productCode: product.productCode },
    });
    if (mode === 'none') return;

    let lotId: string | null = null;
    if (mode === 'batch') {
      const lotNo = item.lotNo?.trim() || grn.grnNo;
      const existing = await tx.stockLot.findFirst({ where: { storeId, productId: product.id, lotNo }, select: { id: true } });
      lotId = existing?.id ?? (await tx.stockLot.create({
        data: {
          storeId, productId: product.id, lotNo, grnItemId: item.id, unitCostPaise: item.unitCostPaise,
          mfgDate: item.mfgDate, expiryDate: item.expiryDate, receivedAt: grn.receivedDate, createdBy: userId,
        },
        select: { id: true },
      })).id;
    }

    await applyMovements(tx, storeId, userId, [{
      productId: product.id, qty: item.qty, reason: 'receipt',
      refType: 'GoodsReceiptNote', refId: grn.id, refNo: grn.grnNo, lotId,
    }]);

    if (mode === 'serial') {
      const identities = completeLineSerials({
        productCode: product.productCode, qty: item.qty,
        typed: Array.from({ length: item.qty }, () => null), at: grn.receivedDate,
      });
      const created = await tx.stockUnit.createManyAndReturn({
        data: identities.map((i) => ({
          storeId, productId: product.id, serialNo: i.serialNo, identitySource: i.identitySource,
          status: 'in_stock', condition: item.isRefurbished ? 'refurbished' : 'new',
          grnItemId: item.id, unitCostPaise: item.unitCostPaise, receivedAt: grn.receivedDate, createdBy: userId,
        })),
        select: { id: true },
      });
      await tx.stockUnitEvent.createMany({
        data: created.map((u) => ({
          storeId, unitId: u.id, eventType: 'received', toStatus: 'in_stock',
          toCondition: item.isRefurbished ? 'refurbished' : 'new', partyId: grn.partyId,
          refType: 'GoodsReceiptNote', refId: grn.id, refNo: grn.grnNo,
          note: 'Line linked to its product after posting - serial still to be filled in from the box.',
          createdBy: userId,
        })),
      });
    }

    if (!grn.sourceBillId) {
      await tx.productPurchasePrice.create({
        data: {
          storeId, productId: product.id, unitCostPaise: item.unitCostPaise, qty: item.qty,
          purchasedAt: grn.receivedDate, supplierId: grn.partyId, reference: grn.grnNo, source: 'grn', createdBy: userId,
        },
      });
    }
  });

  return { grnNo: grn.grnNo, productName: product.productName, qty: item.qty, trackingMode: mode };
}

/**
 * Which of these serials this store already holds, compared case-insensitively.
 *
 * Raw SQL because Prisma cannot express `upper(col) IN (...)` over pairs. The
 * store id is the first predicate, so this reads nothing outside the tenant.
 * Shared with the unit screen's "fill in serials", which has the same rule.
 */
export async function serialsAlreadyOnFile(
  storeId: string,
  wanted: { productId: string; serial: string }[],
): Promise<string[]> {
  if (wanted.length === 0) return [];
  const rows = await db.$queryRawUnsafe<{ serialNo: string }[]>(
    `SELECT u."serialNo" FROM "StockUnit" u
       JOIN unnest($2::text[], $3::text[]) AS x(pid, sn)
         ON u."productId" = x.pid AND upper(u."serialNo") = upper(x.sn)
      WHERE u."storeId" = $1`,
    storeId, wanted.map((w) => w.productId), wanted.map((w) => w.serial),
  );
  return rows.map((r) => r.serialNo);
}

/**
 * Cancel a GRN: stock back out if it was posted, PO receipts unwound, never
 * a delete - the number is filed evidence of what a supplier actually sent,
 * right or wrong.
 *
 * The UNITS it created are the one exception to "never delete". A cancelled
 * receipt means they never arrived, so they cannot stay on the shelf - but
 * only while none of them has done anything since. Once a unit has been sold,
 * reserved or sent anywhere, it has a life of its own, and cancelling the
 * receipt under it would orphan that history; the cancellation is refused
 * instead, and the fix is to correct those units first.
 */
export async function cancelGrn(
  scope: StoreScope,
  grnId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new GrnError('Say why this receipt is being cancelled.');

  const grn = await db.goodsReceiptNote.findFirst({
    where: { id: grnId, ...scopeWhere(scope) },
    select: {
      id: true, grnNo: true, status: true, purchaseOrderId: true,
      items: { select: { id: true, productId: true, qty: true, purchaseOrderItemId: true } },
    },
  });
  if (!grn) throw new GrnError('Goods receipt not found in your scope.');
  if (grn.status === 'cancelled') return;

  const units = grn.status === 'posted'
    ? await db.stockUnit.findMany({
      where: { storeId, grnItemId: { in: grn.items.map((i) => i.id) } },
      select: { id: true, serialNo: true, status: true, _count: { select: { events: true } } },
    })
    : [];
  // One event is the 'received' written at posting. Anything more is a life.
  const used = units.filter((u) => u.status !== 'in_stock' || u._count.events > 1);
  if (used.length > 0) {
    throw new GrnError(
      `${used.length} unit${used.length === 1 ? '' : 's'} from ${grn.grnNo} have already been used`
      + ` (${used.slice(0, 3).map((u) => u.serialNo ?? 'no serial').join(', ')}). Correct those first.`,
    );
  }

  // The lot each line went into, so taking the stock back out takes it out of
  // the same lot rather than leaving the lot's own count wrong.
  const lotMoves = grn.status === 'posted'
    ? await db.stockMovement.findMany({
      where: { storeId, refType: 'GoodsReceiptNote', refId: grn.id, lotId: { not: null } },
      select: { productId: true, lotId: true },
    })
    : [];
  const lotFor = new Map(lotMoves.map((m) => [m.productId, m.lotId]));

  await db.$transaction(async (tx) => {
    if (grn.status === 'posted') {
      const stockItems = grn.items.filter((i) => i.productId);
      if (stockItems.length > 0) {
        await applyMovements(tx, storeId, userId, stockItems.map((i) => ({
          productId: i.productId!,
          qty: -i.qty,
          reason: 'return_out',
          refType: 'GoodsReceiptNote',
          refId: grn.id,
          refNo: grn.grnNo,
          lotId: lotFor.get(i.productId!) ?? null,
          note: `Receipt cancelled: ${reason.trim()}`,
        })));
      }

      if (units.length > 0) {
        await tx.stockUnit.deleteMany({ where: { storeId, id: { in: units.map((u) => u.id) } } });
      }

      if (grn.purchaseOrderId) {
        for (const item of grn.items) {
          if (!item.purchaseOrderItemId) continue;
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: { receivedQty: { decrement: item.qty } },
          });
        }
        await syncPurchaseOrderStatus(tx, grn.purchaseOrderId);
      }
    }

    await tx.goodsReceiptNote.update({
      where: { id: grn.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
  });
}

/**
 * The "Non-PO purchase creates a linked Direct Receipt automatically" rule,
 * called from `purchases.ts::postBill`. Creates a GRN with `sourceBillId`
 * set and posts it in the same call - from a person's point of view, one
 * action ("post this bill") does the whole receiving job, exactly as it did
 * before RULE 2, except the quantity movement now lives in its own record
 * with its own number, the way any other receipt does.
 *
 * Returns null and does nothing if the bill has no stock lines at all - a
 * bill of pure services needs no receipt.
 */
export async function receiveDirectlyForBill(
  scope: StoreScope,
  input: {
    billId: string;
    billNo: string;
    partyId: string;
    supplierName: string;
    receivedDate: Date;
    lines: GrnLineDraft[];
  },
  userId: string,
): Promise<{ id: string; grnNo: string } | null> {
  if (input.lines.length === 0) return null;
  const storeId = scopeForWrite(scope);

  const grnNo = await allocateDocumentNumber(storeId, 'GRN', input.receivedDate);

  const grn = await db.$transaction(async (tx) => {
    const created = await tx.goodsReceiptNote.create({
      data: {
        storeId,
        grnNo,
        partyId: input.partyId,
        supplierName: input.supplierName,
        receivedDate: input.receivedDate,
        status: 'draft',
        sourceBillId: input.billId,
        notes: `Received directly with bill ${input.billNo}`,
      },
    });

    await tx.goodsReceiptNoteItem.createMany({
      data: input.lines.map((l, i) => ({
        storeId,
        grnId: created.id,
        srNo: i + 1,
        productId: l.productId ?? null,
        productName: l.productName.trim(),
        productCode: l.productCode ?? null,
        qty: l.qty,
        unitCostPaise: l.unitCostPaise,
      })),
    });

    return created;
  });

  await postGrn(scope, grn.id, userId);
  return { id: grn.id, grnNo };
}

export async function listGrns(scope: StoreScope) {
  return db.goodsReceiptNote.findMany({
    where: scopeWhere(scope),
    orderBy: { receivedDate: 'desc' },
    select: {
      id: true, grnNo: true, supplierName: true, partyId: true, receivedDate: true,
      status: true, sourceBillId: true, purchaseOrderId: true, notes: true,
      supplierInvoiceNo: true, legacyRef: true,
      items: { select: { qty: true, productId: true } },
    },
    take: LIST_MAX_ROWS,
  });
}

export async function getGrnDetail(scope: StoreScope, id: string) {
  const grn = await db.goodsReceiptNote.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { items: { orderBy: { srNo: 'asc' } } },
  });
  if (!grn) throw new GrnError('Goods receipt not found in your scope.');
  // Decimal does not cross the server/client boundary; the rate is narrowed
  // here so no caller has to remember to.
  return {
    ...grn,
    items: grn.items.map((i) => ({ ...i, taxRatePct: i.taxRatePct !== null ? i.taxRatePct.toNumber() : null })),
  };
}
