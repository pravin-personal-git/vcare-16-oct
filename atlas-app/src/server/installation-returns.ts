import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { applyMovements } from './stock';
import { postCogsMovement } from './cogs';
import { installationEvent } from './job-notify';
import { FEED_MAX_ROWS } from '@/lib/list-limits';

/**
 * UNUSED GOODS BACK FROM AN INSTALLATION (22 Oct 2026, R2 - Vcare feedback;
 * 09-documentation/04-roadmap/TECHNICIAN-UNUSED-RETURNS-ROADMAP.md).
 *
 * An installation's goods leave on its sales order's dispatch - the GDN - the
 * whole order at once (`sales-orders.ts::moveFulfilment`). Ten cameras go,
 * eight are fitted, two come back. Until now Atlas could only take the whole
 * order back, so stock, the bill and the cost all stayed at ten.
 *
 *   request  the technician (or office) says N are coming back. Nothing moves:
 *            saying is not handing over (the complaint rule of 28 Sep 2026).
 *   receive  the store takes them in. Stock comes back AGAINST THE ORDER
 *            (`return_in`, refType SalesOrder) - the document they left on,
 *            for the same customer, the exact unit when one was scanned - and
 *            the cost of those N comes off cost of goods sold.
 *
 * Counted twice, on purpose: on the installation line (what this site used)
 * and on the order line (`SalesOrderItem.returnedQty`), because the order's
 * own return, cancel and invoice count from the order line. That is what
 * stops two cameras coming back once here and again when the order is
 * returned, and what stops them being billed.
 *
 * Billed already? Then a tax invoice names them and it cannot be edited: the
 * office takes them back with a Sales Return on that invoice, which makes the
 * credit note (D5). Refused here rather than half-done.
 */

export class InstallationReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallationReturnError';
  }
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function log(tx: Tx | typeof db, storeId: string, challanId: string, userId: string | null, description: string) {
  await tx.activityLog.create({
    data: { storeId, userId, activityType: 'Return', entityType: 'installation_challan', entityId: challanId, description },
  });
}

async function loadItem(scope: StoreScope, itemId: string) {
  const item = await db.installationChallanItem.findFirst({
    where: { id: itemId, challan: scopeWhere(scope) },
    select: {
      id: true, productId: true, productName: true, qty: true, qtyReturned: true, qtyReturnPending: true,
      stockUnitId: true, salesOrderItemId: true,
      product: { select: { kind: true, trackingMode: true } },
      challan: {
        select: {
          id: true, storeId: true, challanNo: true, isInvoiced: true,
          salesOrder: {
            select: {
              id: true, orderNo: true, partyId: true, isInvoiced: true,
              items: { select: { id: true, productId: true, dispatchedQty: true, returnedQty: true } },
            },
          },
        },
      },
    },
  });
  if (!item) throw new InstallationReturnError('That installation line is not in your scope.');
  return item;
}
type Item = Awaited<ReturnType<typeof loadItem>>;

/** Fitted, still with the customer, and not already said to be coming back. */
export const stillOnSite = (i: { qty: number; qtyReturned: number; qtyReturnPending: number }) =>
  Math.max(0, i.qty - i.qtyReturned - i.qtyReturnPending);

/** The order line these goods left on: the linked one, else the order's line for the product. */
function orderLine(item: Item) {
  const lines = item.challan.salesOrder?.items ?? [];
  return lines.find((l) => l.id === item.salesOrderItemId)
    ?? lines.find((l) => l.productId === item.productId && l.dispatchedQty - l.returnedQty > 0)
    ?? null;
}

/** Everything that has to be true before N of a line can come back. */
function check(item: Item, n: number) {
  if (!Number.isInteger(n) || n <= 0) throw new InstallationReturnError('Enter how many are coming back.');
  if (!item.productId) throw new InstallationReturnError(`${item.productName} is not linked to a product, so it never left stock and cannot come back into it.`);
  if (item.product?.kind === 'service') throw new InstallationReturnError(`${item.productName} is a service - there is nothing to bring back.`);
  const order = item.challan.salesOrder;
  if (!order) throw new InstallationReturnError(`Installation ${item.challan.challanNo} has no sales order, so its goods did not leave on a GDN.`);
  if (item.challan.isInvoiced || order.isInvoiced) {
    throw new InstallationReturnError('This work is already billed. The office takes the goods back with a Sales Return on that invoice - it also makes the credit note.');
  }
  const line = orderLine(item);
  if (!line || line.dispatchedQty - line.returnedQty <= 0) {
    throw new InstallationReturnError(`Order ${order.orderNo} has not been dispatched yet - nothing left stock, so nothing comes back. Change the quantity on the order instead.`);
  }
  if (n > line.dispatchedQty - line.returnedQty) {
    throw new InstallationReturnError(`Only ${line.dispatchedQty - line.returnedQty} of ${item.productName} left on order ${order.orderNo} and have not come back.`);
  }
  // A scanned unit is one physical thing: it comes back whole.
  if (item.stockUnitId && n !== item.qty) throw new InstallationReturnError(`${item.productName} was scanned as one unit - it comes back whole (${item.qty}).`);
  return { order, line };
}

/**
 * The technician (or office) says N of a line are coming back. A request:
 * stock moves when the store receives them.
 */
export async function requestInstallationReturn(scope: StoreScope, itemId: string, qty: number, userId: string): Promise<void> {
  scopeForWrite(scope);
  const n = Math.trunc(qty);
  const item = await loadItem(scope, itemId);
  if (n > stillOnSite(item)) throw new InstallationReturnError(`Only ${stillOnSite(item)} of ${item.productName} are on this installation and not already coming back.`);
  check(item, n);
  // Conditional on what was read, so two taps at once cannot both pass the cap.
  const done = await db.installationChallanItem.updateMany({
    where: { id: item.id, challan: scopeWhere(scope), qtyReturnPending: item.qtyReturnPending, qtyReturned: item.qtyReturned },
    data: { qtyReturnPending: { increment: n } },
  });
  if (done.count === 0) throw new InstallationReturnError('Someone changed this line just now - open it again.');
  await log(db, item.challan.storeId, item.challan.id, userId, `${n} × ${item.productName} unused - to hand back to the store, waiting for the store to receive them.`);
  await installationEvent(item.challan.id, 'parts_returning', `${n} × ${item.productName}`);
}

/** The store receives what was said to be coming back. Returns how many. */
export async function receiveInstallationReturn(scope: StoreScope, itemId: string, userId: string): Promise<number> {
  const storeId = scopeForWrite(scope);
  const item = await loadItem(scope, itemId);
  const n = item.qtyReturnPending;
  if (n <= 0) throw new InstallationReturnError('Nothing is waiting to be received on this line.');
  const { order, line } = check(item, n);
  const note = `Unused, back from installation ${item.challan.challanNo}`;

  await db.$transaction(async (tx) => {
    const moved = await tx.installationChallanItem.updateMany({
      where: { id: item.id, challan: scopeWhere(scope), qtyReturnPending: n },
      data: { qtyReturnPending: 0, qtyReturned: { increment: n }, ...(item.stockUnitId ? { stockUnitId: null } : {}) },
    });
    if (moved.count === 0) throw new InstallationReturnError('This line was received or changed just now - open it again.');
    await tx.salesOrderItem.update({ where: { id: line.id }, data: { returnedQty: { increment: n } } });
    await applyMovements(tx, storeId, userId, [{
      productId: item.productId!, qty: n, reason: 'return_in', refType: 'SalesOrder', refId: order.id, refNo: order.orderNo, note,
      // The exact unit when one was scanned (bound below); otherwise this
      // customer's own units, picked by the ledger.
      ...(item.stockUnitId ? { stockUnitId: item.stockUnitId } : { partyId: order.partyId }),
    }]);
    if (item.stockUnitId) {
      const unit = await tx.stockUnit.findUnique({ where: { id: item.stockUnitId }, select: { status: true } });
      await tx.stockUnit.update({ where: { id: item.stockUnitId }, data: { status: 'in_stock', partyId: null } });
      await tx.stockUnitEvent.create({
        data: { storeId, unitId: item.stockUnitId, eventType: 'status', fromStatus: unit?.status ?? null, toStatus: 'in_stock', refType: 'SalesOrder', refId: order.id, refNo: order.orderNo, createdBy: userId },
      });
    }
    await log(tx, storeId, item.challan.id, userId, `${n} × ${item.productName} received back into stock by the store, against order ${order.orderNo}.`);
  });

  // The cost of those N comes off cost of goods sold - its own entry, like a
  // sales return, at today's cost. Never undoes the stock move if it fails.
  await postCogsMovement(scope, {
    direction: 'in', entryDate: new Date(), description: `Unused back from installation ${item.challan.challanNo} (${order.orderNo})`,
    sourceId: `install-return:${item.id}:${item.qtyReturned + n}`, lines: [{ productId: item.productId!, qty: n }],
  }, userId).catch((e) => console.error('[installation return] cost failed', e));
  return n;
}

/** The store's list: installation goods said to be coming back. */
export async function installationReturnsToReceive(scope: StoreScope) {
  const rows = await db.installationChallanItem.findMany({
    where: { qtyReturnPending: { gt: 0 }, challan: scopeWhere(scope) },
    select: {
      id: true, productName: true, qtyReturnPending: true,
      product: { select: { productCode: true } }, stockUnit: { select: { serialNo: true } },
      challan: { select: { id: true, challanNo: true, salesOrder: { select: { orderNo: true } } } },
    },
    take: FEED_MAX_ROWS,
  });
  return rows.map((r) => ({
    itemId: r.id, qty: r.qtyReturnPending, productName: r.productName, productCode: r.product?.productCode ?? '',
    serialNo: r.stockUnit?.serialNo ?? null,
    challanId: r.challan.id, challanNo: r.challan.challanNo, orderNo: r.challan.salesOrder?.orderNo ?? null,
  }));
}
