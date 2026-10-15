import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import { movesStock } from '@/lib/stock-tracking';
import { bindUnitsForOutflow, issueHouseTaggedUnits, returnUnitsToStock } from './unit-allocation';
import { shortfallNote, type UnitDestination } from '@/lib/unit-allocation';

/**
 * The stock ledger.
 *
 * Two rules, and everything else follows from them:
 *
 *  1. **Every change to stock writes a movement row.** There is no other way to
 *     change a balance. `ProductBalance.currentQty` is a running total kept in
 *     the same transaction as the movement that changed it.
 *
 *  2. **Movements are append-only.** A mistake is corrected by a compensating
 *     movement, never by editing history. When a client's accountant asks why
 *     the stock says 40 and the shelf says 38, the answer has to be a list of
 *     rows, not a shrug.
 *
 * A balance somebody can type over is a balance nobody trusts at audit - which
 * is exactly the state the product was in before this file existed.
 *
 * Spec: 06-inventory.md §1
 */

export type MovementReason =
  | 'dispatch'      // goods left against a sales order
  | 'counter_sale'  // goods handed over at the till, invoiced directly
  | 'receipt'       // goods arrived against a purchase
  | 'adjustment'    // a human counted the shelf
  | 'return_in'     // customer sent it back
  | 'return_out'    // we sent it back to the supplier
  | 'opening'       // initial balance when a product is created
  | 'production_consume' // a component went into a production order
  | 'production_output'  // a finished good came out of a production order
  | 'repair_replacement' // replacement stock dispatched against a service complaint
  | 'job_issue'     // parts issued to a field job on a GDN (workflow spec §4.4)
  | 'job_return'    // unused parts from a field job back into stock
  | 'van_issue'     // stock loaded into a technician's van at the start of a shift
  | 'van_return'    // stock brought back off the van at the end of it
  | 'van_shortfall' // what the van cannot account for, written off against it
  | 'rma_return'    // a job's old unit came back from the supplier replaced or repaired
  | 'unit_status'   // one serialised unit left or returned to the shelf - see lib/stock-units
  // Written only by the Vcare data migration, and kept as their own reasons
  // forever so a reconstructed movement is never mistaken for a counted one:
  | 'migration_backfill' // an outflow replayed from old challans
  | 'migration_opening'; // an opening balance worked BACKWARDS, not counted

export interface MovementInput {
  productId: string;
  /** Signed. Negative takes stock out. */
  qty: number;
  reason: MovementReason;
  refType?: string;
  refId?: string;
  refNo?: string;
  note?: string;
  warehouseId?: string | null;
  /** The lot, for a `batch` product. See `StockLot`. */
  lotId?: string | null;
  /** The single unit that moved, for a `serial` product. See `StockUnit`. */
  stockUnitId?: string | null;

  // ---- identity binding (Rule 4, 3 Oct 2026). See server/unit-allocation.
  //
  // WHY THE CALLER DECLARES THE DESTINATION RATHER THAN IT BEING READ OFF
  // `reason`.
  //
  // `reason` says why the quantity moved; it does not always say what became of
  // the physical items. `adjustment` covers both a stock count finding fewer
  // (those units are lost) and an invoice being edited upward (those units went
  // to the customer) - the same reason, opposite answers. Guessing would mark
  // real units `lost` on an ordinary invoice edit, and a wrongly-lost unit has
  // to be found and corrected by hand.
  //
  // So: the obvious dispatch reasons default to `customer` below, `return_out`
  // to `supplier`, and everything else binds NOTHING unless its caller says so.
  // Not binding is always recoverable; binding wrongly is not.

  /** What becomes of the units leaving. Omitted = the default for `reason`. */
  unitDestination?: UnitDestination;
  /** Who takes them. Required for a customer or supplier destination. */
  partyId?: string | null;
  /** The invoice behind it, so the unit carries its sale. */
  invoiceId?: string | null;
  /**
   * Units the operator chose - a scanner at the counter. When given, these are
   * bound in this order and nothing is picked automatically.
   */
  stockUnitIds?: string[];
  /**
   * For an INFLOW of a serial product: the document the units originally left
   * on, so a return puts the same items back rather than somebody else's.
   */
  returnFromInvoiceId?: string | null;
}

/**
 * The destination each reason implies, where it implies one unambiguously.
 *
 * Anything absent from this map binds nothing unless its caller passes
 * `unitDestination`. That includes `adjustment` (see the note above),
 * `production_consume` (a component consumed into a finished good has no honest
 * status in `UNIT_STATUSES` - `scrapped` reads as thrown away, and linking a
 * component's serial to the finished unit it went into needs a relation that
 * does not exist yet), and both `migration_*` reasons, which replay history and
 * must never move a unit that is on a shelf today.
 */
const DEFAULT_DESTINATION: Partial<Record<MovementReason, UnitDestination>> = {
  dispatch: 'customer',
  counter_sale: 'customer',
  job_issue: 'customer',
  repair_replacement: 'customer',
  return_out: 'supplier',
};

/** Reasons where stock coming back means units coming back to the shelf. */
const RETURNS_UNITS: readonly MovementReason[] = ['return_in', 'job_return', 'rma_return'];

/**
 * Apply movements inside an existing transaction.
 *
 * Takes a transaction client rather than opening its own, because stock never
 * moves on its own - it moves *because* an order was dispatched or a receipt
 * was booked. If the document write rolls back, the stock movement must roll
 * back with it, or the ledger and the paperwork disagree forever.
 *
 * A PRODUCT THAT IS NOT STOCKED NEVER MOVES, whoever asks. `trackingMode`
 * `none` covers labour, charges and AMC fees, and it used to be each calling
 * document's job to remember that - an invoice line for "INSTALLATION" would
 * otherwise deduct one installation from a shelf. Checked here, once, so no
 * new document type can forget it. The lookup is scoped to `storeId`, so a
 * product id from another store is refused rather than moved.
 */
export async function applyMovements(
  tx: Prisma.TransactionClient,
  storeId: string,
  userId: string | null,
  movements: MovementInput[],
): Promise<void> {
  const ids = [...new Set(movements.filter((m) => m.qty !== 0).map((m) => m.productId))];
  if (ids.length === 0) return;

  const products = await tx.product.findMany({
    where: { id: { in: ids }, storeId },
    select: { id: true, trackingMode: true, kind: true },
  });
  const modeOf = new Map(products.map((p) => [p.id, p.trackingMode]));
  const serialProducts = new Set(
    products.filter((p) => p.trackingMode === 'serial' && p.kind !== 'service').map((p) => p.id),
  );
  // A service holds no stock, whatever its tracking mode says (health check
  // B0, 25 Sep 2026): billing 'Installation' or 'AMC charges' at the counter
  // used to drive a negative balance. Every caller goes through here, so this
  // one check covers invoices, orders, returns and edits alike.
  const isService = new Set(products.filter((p) => p.kind === 'service').map((p) => p.id));
  const missing = ids.filter((id) => !modeOf.has(id));
  if (missing.length > 0) {
    throw new Error(`Cannot move stock for ${missing.length} product(s) that are not in this store.`);
  }

  for (const m of movements) {
    if (m.qty === 0) continue;
    if (isService.has(m.productId)) continue;
    if (!movesStock(modeOf.get(m.productId)!)) continue;

    // One balance row per product per warehouse. `null` warehouse is the
    // store's default holding - most tenants never split by warehouse at all.
    const existing = await tx.productBalance.findFirst({
      where: { productId: m.productId, warehouseId: m.warehouseId ?? null },
      select: { id: true, currentQty: true },
    });

    const balanceAfter = (existing?.currentQty ?? 0) + m.qty;

    // Negative stock is always a data error - either goods left without being
    // recorded, or an opening balance was never entered. It is not blocked,
    // deliberately: existing tenants have live stock data with a real history
    // of going negative, and refusing every dispatch on that history would
    // make the app unusable for a problem this write cannot retroactively fix.
    // GRN/receipt exists now (see `goods-receipt.ts`), so the original reason
    // for not blocking - nowhere to put stock IN - no longer holds; revisit
    // blocking as its own decision, not a side effect of RULE 2 landing.
    //
    // What it must not do is happen silently. It goes on the movement's note so
    // the ledger carries the evidence, and the Products screen surfaces it as
    // its own count.
    const wentNegative = balanceAfter < 0 && (existing?.currentQty ?? 0) >= 0;

    /**
     * RULE 4 - identity binds here, in the one place every document passes
     * through (3 Oct 2026, see server/unit-allocation).
     *
     * Done BEFORE the movement row is written so the shortfall can go on its
     * note. A dispatch that could not name every item it sent says so on the
     * ledger line itself, which is where somebody reconciling a shelf will be
     * looking - not in a log, and not nowhere, which is where it went before.
     *
     * `stockUnitId` already set means the caller moved exactly one named unit
     * (the move-unit screen, RMA) and has done the binding itself.
     */
    let identityNote: string | null = null;
    if (serialProducts.has(m.productId) && !m.stockUnitId) {
      const destination = m.unitDestination ?? DEFAULT_DESTINATION[m.reason] ?? 'none';

      if (m.qty < 0 && destination !== 'none') {
        const r = await bindUnitsForOutflow(tx, storeId, userId, {
          productId: m.productId,
          qty: m.qty,
          destination,
          partyId: m.partyId ?? null,
          invoiceId: m.invoiceId ?? null,
          refType: m.refType ?? null,
          refId: m.refId ?? null,
          refNo: m.refNo ?? null,
          explicitUnitIds: m.stockUnitIds,
        });
        identityNote = shortfallNote(r.bound, r.short);
      } else if (m.qty > 0 && (RETURNS_UNITS.includes(m.reason) || m.returnFromInvoiceId)) {
        /**
         * Stock coming back means units coming back - either because the reason
         * says so, or because the caller named the document they left on.
         *
         * That second condition is what makes an invoice EDIT work in both
         * directions: its reason is `adjustment`, which binds nothing by
         * default, but an edit that lowers a quantity knows exactly which
         * invoice the items are returning from and says so.
         */
        // No shortfall note on a return. Not finding the original unit is
        // normal on migrated data and is not evidence of anything missing -
        // the quantity is back on the shelf either way.
        await returnUnitsToStock(tx, storeId, userId, {
          productId: m.productId,
          qty: m.qty,
          fromInvoiceId: m.returnFromInvoiceId ?? null,
          partyId: m.partyId ?? null,
          refType: m.refType ?? null,
          refId: m.refId ?? null,
          refNo: m.refNo ?? null,
        });
      }
    }

    if (existing) {
      await tx.productBalance.update({
        where: { id: existing.id },
        data: {
          currentQty: balanceAfter,
          lastMovementAt: new Date(),
          ...(m.reason === 'dispatch' ? { lastSoldAt: new Date() } : {}),
        },
      });
    } else {
      await tx.productBalance.create({
        data: {
          productId: m.productId,
          warehouseId: m.warehouseId ?? null,
          currentQty: balanceAfter,
          lastMovementAt: new Date(),
          ...(m.reason === 'dispatch' ? { lastSoldAt: new Date() } : {}),
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        storeId,
        productId: m.productId,
        warehouseId: m.warehouseId ?? null,
        qty: m.qty,
        reason: m.reason,
        refType: m.refType ?? null,
        refId: m.refId ?? null,
        refNo: m.refNo ?? null,
        lotId: m.lotId ?? null,
        stockUnitId: m.stockUnitId ?? null,
        balanceAfter,
        note: [
          m.note,
          wentNegative
            ? `Stock went negative (${balanceAfter}). Opening balance or a receipt is missing.`
            : null,
          identityNote,
        ].filter(Boolean).join(' - ') || null,
        createdBy: userId,
      },
    });
  }
}

/**
 * Whether a set of lines can be dispatched without driving stock negative.
 *
 * Returns the offending lines rather than a boolean, so the caller can tell the
 * user *which* product is short and by how much. "Insufficient stock" with no
 * detail is a message people learn to click past.
 *
 * Deliberately advisory, not enforced: a shop that has physically handed goods
 * over must be able to record it even when the system's count is wrong. The
 * fix for a wrong count is a stock adjustment, not a blocked dispatch.
 */
export async function checkAvailability(
  scope: StoreScope,
  lines: { productId: string | null; productName: string; qty: number }[],
): Promise<{ productName: string; wanted: number; available: number }[]> {
  const ids = lines.map((l) => l.productId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];

  const balances = await db.productBalance.findMany({
    // Scoped through the product. Without this, a productId from another store
    // would read that store's balance - which nothing does today because
    // nothing calls this yet, and that is exactly when to fix it.
    where: { productId: { in: ids }, product: { ...scopeWhere(scope) } },
    select: { productId: true, currentQty: true },
  });

  const have = new Map<string, number>();
  for (const b of balances) {
    have.set(b.productId, (have.get(b.productId) ?? 0) + b.currentQty);
  }

  const short: { productName: string; wanted: number; available: number }[] = [];
  for (const l of lines) {
    if (!l.productId) continue;
    const available = have.get(l.productId) ?? 0;
    if (available < l.qty) {
      short.push({ productName: l.productName, wanted: l.qty, available });
    }
  }
  return short;
}

export interface MovementRow {
  id: string;
  productName: string;
  productCode: string;
  qty: number;
  reason: string;
  refType: string | null;
  refNo: string | null;
  balanceAfter: number;
  note: string | null;
  createdAt: Date;
  byName: string | null;
}

/** Ledger for one product, or the whole store when productId is omitted. */
export async function listMovements(
  scope: StoreScope,
  productId?: string,
  take = 200,
): Promise<MovementRow[]> {
  const [rows, users] = await Promise.all([
    db.stockMovement.findMany({
      where: { ...scopeWhere(scope), ...(productId ? { productId } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, qty: true, reason: true, refType: true, refNo: true,
        balanceAfter: true, note: true, createdAt: true, createdBy: true,
        product: { select: { productName: true, productCode: true } },
      },
    }),
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
  ]);

  const name = new Map(users.map((u) => [u.id, u.fullName]));

  return rows.map((r) => ({
    id: r.id,
    productName: r.product.productName,
    productCode: r.product.productCode,
    qty: r.qty,
    reason: r.reason,
    refType: r.refType,
    refNo: r.refNo,
    balanceAfter: r.balanceAfter,
    note: r.note,
    createdAt: r.createdAt,
    byName: r.createdBy ? name.get(r.createdBy) ?? null : null,
  }));
}

/**
 * A manual count correction. The only movement a person enters by hand.
 *
 * IDENTITY-AWARE SINCE 3 OCT 2026. A physical count is the most authoritative
 * fact Atlas ever receives - somebody stood in front of the shelf - so for a
 * serial-tracked product it corrects BOTH ledgers, not just the quantity:
 *
 *   counted FEWER   the missing units are marked `lost`, oldest first. They
 *                   were on the shelf according to Atlas and are not there.
 *   counted MORE    the extra items exist and carry no number, so each gets a
 *                   house tag (lib/house-tag) and a unit record.
 *
 * Before this, a count fixed the quantity and left the unit table untouched, so
 * the two ledgers drifted further apart every time somebody tried to correct
 * them - which is the worst possible behaviour for a correction tool.
 */
export async function recordAdjustment(
  scope: StoreScope,
  storeId: string,
  userId: string,
  productId: string,
  countedQty: number,
  note: string,
): Promise<{ delta: number; balanceAfter: number; unitsTagged: number; unitsLost: number }> {
  const product = await db.product.findFirst({
    where: { id: productId, ...scopeWhere(scope) },
    select: { id: true, productName: true, productCode: true, trackingMode: true },
  });
  if (!product) throw new Error('Product not found in your scope.');

  const balance = await db.productBalance.findFirst({
    where: { productId, warehouseId: null },
    select: { currentQty: true },
  });

  const current = balance?.currentQty ?? 0;
  const delta = countedQty - current;

  if (delta === 0) {
    return { delta: 0, balanceAfter: current, unitsTagged: 0, unitsLost: 0 };
  }

  let unitsTagged = 0;
  let unitsLost = 0;

  await db.$transaction(async (tx) => {
    await applyMovements(tx, storeId, userId, [{
      productId,
      qty: delta,
      reason: 'adjustment',
      refType: 'Manual',
      // Record what was counted and what the system thought - the difference
      // alone loses the information that matters when this is reviewed.
      note: `Counted ${countedQty}, system had ${current}. ${note}`.trim(),
      // A count that found FEWER has lost those units. Said explicitly because
      // `adjustment` binds nothing by default: its other caller is an invoice
      // edit, where the right answer is the customer, and guessing between the
      // two would mark real units lost on an ordinary edit.
      ...(delta < 0 ? { unitDestination: 'lost' as const } : {}),
    }]);

    if (product.trackingMode === 'serial') {
      const after = await tx.stockUnit.count({
        where: { storeId, productId, deletedAt: null, status: { in: ['in_stock', 'reserved'] } },
      });
      if (delta < 0) {
        // What `applyMovements` actually managed to mark lost.
        unitsLost = Math.min(-delta, Math.max(0, current - after));
      } else if (countedQty > after) {
        /**
         * More on the shelf than carry a number. The items are real - somebody
         * just counted them - so each gets a house tag rather than staying
         * anonymous. This is the one-at-a-time version of closing the 39,000
         * item gap, and it only ever runs on a product a person has counted.
         */
        unitsTagged = await issueHouseTaggedUnits(tx, storeId, userId, {
          productId,
          productCode: product.productCode,
          count: countedQty - after,
          note: `Found at a stock count on ${new Date().toISOString().slice(0, 10)}. ${note}`.trim(),
        });
      }
    }
  });

  return { delta, balanceAfter: countedQty, unitsTagged, unitsLost };
}
