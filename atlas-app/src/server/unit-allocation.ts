import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { freeToSell, type UnitDestination, DESTINATION_STATUS } from '@/lib/unit-allocation';
import { houseTags } from '@/lib/house-tag';

/**
 * RULES 3 AND 4 - reserve the count, bind the identity (3 Oct 2026).
 *
 * See 09-documentation/03-specs/STOCK-IDENTITY-SPEC.md. Rule 1 (identity
 * created at intake) shipped on 2 Oct; this is the other end of the same chain.
 *
 * ## Rule 4 - identity binds at dispatch, and only at dispatch
 *
 * `sales-orders.ts` and `invoices.ts` contained **zero** references to
 * `StockUnit`. Selling moved quantity and never recorded which physical item
 * left, which is why not one of the 2,775 units on record was linked to an
 * invoice, and why 1,215 said "with a customer" without naming one.
 *
 * Fixed in ONE place - inside `applyMovements` - rather than in each of the 23
 * call sites that move stock. A rule enforced in twenty-three places is a rule
 * that will be forgotten in the twenty-fourth.
 *
 * ## It allocates rather than refusing, and that is deliberate
 *
 * The spec's first draft had dispatch REFUSE unless the operator picked exactly
 * as many units as were leaving. That is correct and it is also unusable here:
 * on this data 91 products already have fewer units than shelf quantity, so a
 * counter would refuse a third of its sales from the day it shipped, for a
 * problem the sale did not cause and cannot fix.
 *
 * So Atlas picks, oldest first, and binds. The operator may still choose units
 * explicitly - a scanner at the counter passes them - and then their choice
 * wins. Where there genuinely are not enough units on record, the shortfall is
 * written onto the movement's own note and shows up on Stock Checks. Visible,
 * never silent, and never a blocked sale.
 *
 * ## Oldest first, and why that is the only defensible order
 *
 * FIFO by `receivedAt`. Not newest-first, which would leave the oldest stock on
 * the shelf forever and quietly turn it into dead stock; not random, which
 * cannot be explained to an auditor. It also matches how a storeman actually
 * works - the box at the back goes out first - and for anything with a shelf
 * life it is the only order that is not negligent.
 */

export interface OutflowBinding {
  productId: string;
  /** How many items are leaving. Positive. */
  qty: number;
  /** What becomes of them. `none` means do not bind - see the caller's reason. */
  destination: UnitDestination;
  /** The customer or supplier taking them. Required for customer/supplier. */
  partyId: string | null;
  /** The invoice behind it, when there is one. */
  invoiceId: string | null;
  refType: string | null;
  refId: string | null;
  refNo: string | null;
  /**
   * Units the operator chose. When given, these are used in this order and
   * nothing is picked automatically.
   */
  explicitUnitIds?: string[];
}

export interface BindResult {
  /** How many units were bound to the document. */
  bound: number;
  /** Items that left with no unit on record. Zero on healthy data. */
  short: number;
  /** The serials bound, for the movement note and the audit trail. */
  serials: string[];
}

/**
 * Bind units to one outflow, inside the caller's transaction.
 *
 * Returns what it managed to do rather than throwing on a shortfall. The caller
 * records the shortfall; it does not get to pretend there wasn't one.
 */
export async function bindUnitsForOutflow(
  tx: Prisma.TransactionClient,
  storeId: string,
  userId: string | null,
  b: OutflowBinding,
): Promise<BindResult> {
  const want = Math.abs(Math.trunc(b.qty));
  if (want === 0 || b.destination === 'none') return { bound: 0, short: 0, serials: [] };

  const toStatus = DESTINATION_STATUS[b.destination];

  /**
   * A customer or supplier destination must name one.
   *
   * `StockUnit.partyId` is read through the status - a unit that says
   * `with_customer` and names nobody is the exact hole this work exists to
   * close, and creating more of them here would be absurd. Without a party the
   * unit is left alone and the shortfall is reported, which is honest: we know
   * something left and not who has it.
   */
  const needsParty = b.destination === 'customer' || b.destination === 'supplier';
  if (needsParty && !b.partyId) return { bound: 0, short: want, serials: [] };

  const picked = b.explicitUnitIds?.length
    ? await tx.stockUnit.findMany({
      where: {
        storeId, productId: b.productId, deletedAt: null,
        id: { in: b.explicitUnitIds.slice(0, want) },
        // Only something on the shelf can leave it. An operator scanning a
        // unit that already went to another customer is told nothing here -
        // it is simply not picked, and the shortfall says so.
        status: { in: ['in_stock', 'reserved'] },
      },
      select: { id: true, serialNo: true, status: true },
    })
    : await tx.stockUnit.findMany({
      where: {
        storeId, productId: b.productId, deletedAt: null,
        status: { in: ['in_stock', 'reserved'] },
      },
      // FIFO. `id` as the tie-break so two units received in the same second
      // are still picked in a stable, repeatable order.
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: want,
      select: { id: true, serialNo: true, status: true },
    });

  for (const u of picked) {
    await tx.stockUnit.update({
      where: { id: u.id },
      data: {
        status: toStatus,
        // Cleared for a destination nobody holds. A scrapped unit that still
        // names a customer reads as being at their site.
        partyId: needsParty ? b.partyId : null,
        ...(b.destination === 'customer' && b.invoiceId ? { invoiceId: b.invoiceId } : {}),
      },
    });

    await tx.stockUnitEvent.create({
      data: {
        storeId,
        unitId: u.id,
        eventType: 'status',
        fromStatus: u.status,
        toStatus,
        partyId: needsParty ? b.partyId : null,
        refType: b.refType,
        refId: b.refId,
        refNo: b.refNo,
        /**
         * Said in the unit's own history: this was chosen by Atlas, not read
         * off a scanner. A year later somebody arguing about which camera went
         * where needs to know which of those two it was.
         */
        note: b.explicitUnitIds?.length
          ? 'Chosen at dispatch.'
          : 'Allocated automatically, oldest stock first.',
        createdBy: userId,
      },
    });
  }

  return {
    bound: picked.length,
    short: want - picked.length,
    serials: picked.map((u) => u.serialNo).filter((s): s is string => !!s),
  };
}

/**
 * Put units back on the shelf - a customer return, or unused job parts.
 *
 * Prefers the units that went out on THAT document, which is almost always
 * right and is the only choice that keeps a unit's history coherent: a camera
 * that went out on INV-0042 and comes back on a return against INV-0042 is the
 * same camera. Falls back to nothing rather than guessing at some other
 * customer's unit.
 */
export async function returnUnitsToStock(
  tx: Prisma.TransactionClient,
  storeId: string,
  userId: string | null,
  input: {
    productId: string;
    qty: number;
    /** The document the units originally left on. */
    fromInvoiceId?: string | null;
    partyId?: string | null;
    refType: string | null;
    refId: string | null;
    refNo: string | null;
    condition?: 'new' | 'refurbished';
  },
): Promise<BindResult> {
  const want = Math.abs(Math.trunc(input.qty));
  if (want === 0) return { bound: 0, short: 0, serials: [] };

  /**
   * Which document they came back from, when the caller knows.
   *
   * Hoisting the whole `where` out of the call would hide `storeId` from the
   * store-scope coverage test, which reads call sites literally - and a test
   * that cannot see the scope filter is a test that cannot protect it. So only
   * the optional part is built up here, and the scope stays at the query.
   */
  const origin: Prisma.StockUnitWhereInput = input.fromInvoiceId
    ? { invoiceId: input.fromInvoiceId }
    : input.partyId ? { partyId: input.partyId } : {};

  const picked = await tx.stockUnit.findMany({
    where: {
      storeId, productId: input.productId, deletedAt: null,
      status: { in: ['with_customer', 'with_supplier'] },
      ...origin,
    },
    // Last out, first back: on a return the item most recently sent is the one
    // most likely being sent back.
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: want,
    select: { id: true, serialNo: true, status: true, condition: true },
  });

  for (const u of picked) {
    await tx.stockUnit.update({
      where: { id: u.id },
      data: {
        status: 'in_stock',
        partyId: null,
        ...(input.condition ? { condition: input.condition } : {}),
      },
    });
    await tx.stockUnitEvent.create({
      data: {
        storeId,
        unitId: u.id,
        eventType: 'status',
        fromStatus: u.status,
        toStatus: 'in_stock',
        refType: input.refType,
        refId: input.refId,
        refNo: input.refNo,
        note: 'Back on the shelf.',
        createdBy: userId,
      },
    });
  }

  return {
    bound: picked.length,
    short: want - picked.length,
    serials: picked.map((u) => u.serialNo).filter((s): s is string => !!s),
  };
}

/* ------------------------------------------------- Rule 3: reserve the count */

export interface Availability {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  onHand: number;
  /** Promised to confirmed orders that have not been dispatched. */
  promised: number;
  /** onHand minus promised, floored at zero. */
  free: number;
}

/**
 * What is actually free to sell, for a set of products.
 *
 * ## Derived, never stored
 *
 * `ProductBalance.reservedQty` exists in the schema and **nothing has ever
 * written to it** - it has read 0 for every product since the column was
 * created. That is lucky rather than good: a stored reservation total drifts
 * the first time an order is cancelled without the decrement running, and then
 * a shop is told it cannot sell stock that is sitting on its shelf. The column
 * is left at zero deliberately and this function is the answer instead.
 *
 * ## What counts as promised
 *
 * An order line on a CONFIRMED order that has not yet been dispatched, less
 * whatever has already gone. A quotation reserves nothing - two salespeople may
 * quote the same last camera, which is Atlas doctrine and is also how trade
 * works. A booked order awaiting approval reserves nothing either: it is not an
 * order yet.
 *
 * ## It is advice, not a block
 *
 * Nothing here refuses a sale. A shop that has physically handed goods over has
 * to be able to record it. The number exists so a salesperson sees "4 free of 7
 * on the shelf" BEFORE they promise, which is where the error actually happens.
 */
export async function availabilityFor(
  scope: StoreScope, productIds: string[],
): Promise<Map<string, Availability>> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const [products, lines] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids }, ...scopeWhere(scope), deletedAt: null },
      select: {
        id: true, productCode: true, productName: true, unit: true,
        balances: { select: { currentQty: true } },
      },
    }),
    db.salesOrderItem.findMany({
      where: {
        productId: { in: ids },
        deletedAt: null,
        salesOrder: {
          ...scopeWhere(scope),
          deletedAt: null,
          // Confirmed and not yet gone. `packed` still counts as promised -
          // the goods are in a box with somebody's name on it.
          fulfilmentStatus: { in: ['confirmed', 'packed'] },
        },
      },
      select: { productId: true, qty: true, dispatchedQty: true },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const promised = new Map<string, number>();
  for (const l of lines) {
    if (!l.productId) continue;
    const outstanding = Math.max(0, l.qty - (l.dispatchedQty ?? 0));
    promised.set(l.productId, (promised.get(l.productId) ?? 0) + outstanding);
  }

  const out = new Map<string, Availability>();
  for (const p of products) {
    const onHand = p.balances.reduce((n, b) => n + b.currentQty, 0);
    const prom = promised.get(p.id) ?? 0;
    out.set(p.id, {
      productId: p.id,
      productCode: p.productCode,
      productName: p.productName,
      unit: p.unit,
      onHand,
      promised: prom,
      free: freeToSell(onHand, prom),
    });
  }
  return out;
}

/* ----------------------------------------------- closing the gap, one product */

/**
 * Give Atlas-issued numbers to stock that is on the shelf and carries none.
 *
 * Three callers, all of which have established that the items physically exist
 * before asking:
 *
 *   a stock count (`recordAdjustment`)  somebody counted more than are numbered
 *   the fix on Stock Checks            somebody asserts the shelf is right
 *   a finished production run          the items were just made, so of course
 *                                      they carry no vendor serial
 *
 * That is the only basis on which creating a unit record is honest. It is never
 * called to paper over a gap nobody has looked at.
 *
 * It does NOT write a stock movement. In every case the quantity is already
 * correct - counted, asserted, or moved by the production output - and this
 * only brings the identity ledger up to it. Writing a movement as well would
 * add the items to the shelf a second time.
 */
export async function issueHouseTaggedUnits(
  tx: Prisma.TransactionClient,
  storeId: string,
  userId: string | null,
  input: { productId: string; productCode: string; count: number; note: string },
): Promise<number> {
  const n = Math.trunc(input.count);
  if (n <= 0) return 0;

  const existing = await tx.stockUnit.findMany({
    where: { storeId, productId: input.productId },
    select: { serialNo: true },
  });

  const now = new Date();
  const tags = houseTags(input.productCode, now, n, existing.map((u) => u.serialNo));

  const created = await tx.stockUnit.createManyAndReturn({
    data: tags.map((serialNo) => ({
      storeId,
      productId: input.productId,
      serialNo,
      identitySource: 'house',
      status: 'in_stock',
      condition: 'new',
      /**
       * No `grnItemId` and no `unitCostPaise`, and that is the honest answer:
       * nobody knows which delivery this item came in on, so it has no supplier
       * and no cost. The product history says so rather than showing a figure
       * somebody would plan against.
       */
      receivedAt: now,
      note: input.note,
      createdBy: userId,
    })),
    select: { id: true },
  });

  await tx.stockUnitEvent.createMany({
    data: created.map((u) => ({
      storeId,
      unitId: u.id,
      eventType: 'received',
      toStatus: 'in_stock',
      toCondition: 'new',
      refType: 'StockCount',
      note: 'Counted on the shelf with no serial. Atlas issued this number - print the label and stick it on.',
      createdBy: userId,
    })),
  });

  return created.length;
}

/**
 * The one-click fix on Stock Checks: make the identity ledger match the shelf.
 *
 * ## Why the shelf wins
 *
 * The quantity ledger is written by every document path - receipts, invoices,
 * orders, returns, manufacturing, adjustments - and has been since the ledger
 * existed. The identity ledger was written by four paths until 2 Oct. When they
 * disagree, the one with twenty writers and a movement row behind every change
 * is not the one that is wrong.
 *
 * So: more on the shelf than numbered means items need labels; more numbered
 * than on the shelf means units that are not there, and those are marked `lost`
 * rather than deleted - a unit that existed and cannot be found is a fact worth
 * keeping, and deleting it would lose the serial somebody may still quote.
 *
 * ## It is one click because typing is where the errors are
 *
 * The alternative is asking somebody to retype a number Atlas already knows.
 * That invites a typo on every one of 91 products, and a typo here moves stock.
 */
export async function reconcileProductIdentity(
  scope: StoreScope,
  storeId: string,
  userId: string,
  productId: string,
): Promise<{ productName: string; tagged: number; lost: number }> {
  const product = await db.product.findFirst({
    where: { id: productId, ...scopeWhere(scope), deletedAt: null },
    select: {
      id: true, productName: true, productCode: true, trackingMode: true,
      balances: { select: { currentQty: true } },
    },
  });
  if (!product) throw new Error('Product not found in your scope.');
  if (product.trackingMode !== 'serial') {
    throw new Error(`${product.productName} is not tracked by serial number, so there is nothing to reconcile.`);
  }

  const shelfQty = product.balances.reduce((n, b) => n + b.currentQty, 0);

  return db.$transaction(async (tx) => {
    const onShelfUnits = await tx.stockUnit.count({
      where: { storeId, productId, deletedAt: null, status: { in: ['in_stock', 'reserved'] } },
    });
    const gap = shelfQty - onShelfUnits;
    if (gap === 0) return { productName: product.productName, tagged: 0, lost: 0 };

    if (gap > 0) {
      const tagged = await issueHouseTaggedUnits(tx, storeId, userId, {
        productId,
        productCode: product.productCode,
        count: gap,
        note: 'Numbered to match the shelf count (Stock Checks).',
      });
      return { productName: product.productName, tagged, lost: 0 };
    }

    // More numbered than on the shelf. Mark the oldest missing, because the
    // oldest stock is what goes out first and is therefore what is gone.
    const extra = await tx.stockUnit.findMany({
      where: { storeId, productId, deletedAt: null, status: { in: ['in_stock', 'reserved'] } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: -gap,
      select: { id: true, status: true },
    });
    for (const u of extra) {
      await tx.stockUnit.update({ where: { id: u.id }, data: { status: 'lost', partyId: null } });
      await tx.stockUnitEvent.create({
        data: {
          storeId,
          unitId: u.id,
          eventType: 'status',
          fromStatus: u.status,
          toStatus: 'lost',
          refType: 'StockCount',
          note: 'Not on the shelf when the stock count was reconciled. Kept rather than deleted - the serial may still be quoted.',
          createdBy: userId,
        },
      });
    }
    return { productName: product.productName, tagged: 0, lost: extra.length };
  });
}
