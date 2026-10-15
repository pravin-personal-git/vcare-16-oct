import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements } from './stock';
import { issueHouseTaggedUnits } from './unit-allocation';
import { deriveExpiry } from '@/lib/expiry-policy';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Light manufacturing - spec 06-inventory.md §2/§3 ("Bill of Materials",
 * "Production Order"). Not full MRP: no reservation, no WIP, no partial
 * completion. A BOM says what a finished product is made of; a Production
 * Order either hasn't happened (`draft`) or has - components consumed and
 * the finished good produced together, in one step.
 */

export class ManufacturingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManufacturingError';
  }
}

// ------------------------------------------------------------- Bill of Materials

export interface BomComponentInput { productId: string; qty: number }

export interface CreateBomInput {
  finishedProductId: string;
  outputQty: number;
  notes?: string | null;
  components: BomComponentInput[];
}

export async function listBoms(scope: StoreScope) {
  return db.billOfMaterials.findMany({
    where: scopeWhere(scope),
    select: {
      id: true, outputQty: true, isActive: true, notes: true, createdAt: true,
      finishedProduct: { select: { id: true, productName: true, productCode: true } },
      components: {
        select: { id: true, qty: true, product: { select: { id: true, productName: true, productCode: true } } },
      },
      _count: { select: { productionOrders: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
}

export async function createBom(
  scope: StoreScope, input: CreateBomInput, userId: string,
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);

  if (input.outputQty <= 0) throw new ManufacturingError('Output quantity must be greater than zero.');
  if (input.components.length === 0) throw new ManufacturingError('Add at least one component.');

  const finished = await db.product.findFirst({
    where: { id: input.finishedProductId, ...scopeWhere(scope) },
    select: { id: true, productName: true },
  });
  if (!finished) throw new ManufacturingError('Finished product not found in your scope.');

  const merged = new Map<string, number>();
  for (const c of input.components) {
    if (c.qty <= 0) continue;
    if (c.productId === input.finishedProductId) {
      throw new ManufacturingError(`${finished.productName} cannot be a component of itself.`);
    }
    merged.set(c.productId, (merged.get(c.productId) ?? 0) + c.qty);
  }
  if (merged.size === 0) throw new ManufacturingError('Enter a quantity greater than zero for at least one component.');

  const componentProducts = await db.product.findMany({
    where: { id: { in: [...merged.keys()] }, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (componentProducts.length !== merged.size) {
    throw new ManufacturingError('One or more components were not found in your scope.');
  }

  const bom = await db.billOfMaterials.create({
    data: {
      storeId,
      finishedProductId: input.finishedProductId,
      outputQty: input.outputQty,
      notes: input.notes ?? null,
      createdBy: userId,
      components: {
        create: [...merged].map(([productId, qty]) => ({ productId, qty })),
      },
    },
  });

  return { id: bom.id };
}

/**
 * Edit a BOM (health check SVC-3). The finished product stays - a different
 * product is a different BOM. Components are replaced as a set. Production
 * orders already completed keep what they actually consumed (their stock
 * movements); draft orders pick up the new recipe when they are completed.
 */
export async function updateBom(
  scope: StoreScope, id: string, input: Omit<CreateBomInput, 'finishedProductId'>,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const bom = await db.billOfMaterials.findFirst({
    where: { id, storeId },
    select: { id: true, finishedProductId: true, finishedProduct: { select: { productName: true } } },
  });
  if (!bom) throw new ManufacturingError('BOM not found in your scope.');
  if (input.outputQty <= 0) throw new ManufacturingError('Output quantity must be greater than zero.');

  const merged = new Map<string, number>();
  for (const c of input.components) {
    if (c.qty <= 0) continue;
    if (c.productId === bom.finishedProductId) {
      throw new ManufacturingError(`${bom.finishedProduct.productName} cannot be a component of itself.`);
    }
    merged.set(c.productId, (merged.get(c.productId) ?? 0) + c.qty);
  }
  if (merged.size === 0) throw new ManufacturingError('Enter a quantity greater than zero for at least one component.');
  const found = await db.product.count({ where: { id: { in: [...merged.keys()] }, ...scopeWhere(scope) } });
  if (found !== merged.size) throw new ManufacturingError('One or more components were not found in your scope.');

  await db.$transaction([
    db.billOfMaterials.update({ where: { id }, data: { outputQty: input.outputQty, notes: input.notes ?? null } }),
    db.bomComponent.deleteMany({ where: { bomId: id } }),
    db.bomComponent.createMany({ data: [...merged].map(([productId, qty]) => ({ bomId: id, productId, qty })) }),
  ]);
}

export async function setBomActive(
  scope: StoreScope, id: string, isActive: boolean,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const updated = await db.billOfMaterials.updateMany({
    where: { id, storeId },
    data: { isActive },
  });
  if (updated.count === 0) throw new ManufacturingError('BOM not found in your scope.');
}

// ------------------------------------------------------------- Production Order

export async function listProductionOrders(scope: StoreScope) {
  return db.productionOrder.findMany({
    where: scopeWhere(scope),
    select: {
      id: true, orderNo: true, qtyToProduce: true, status: true, notes: true,
      createdAt: true, completedAt: true, cancelledAt: true, cancelReason: true,
      bom: {
        select: {
          id: true, outputQty: true,
          finishedProduct: { select: { productName: true, productCode: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
}

export interface CreateProductionOrderInput {
  bomId: string;
  qtyToProduce: number;
  warehouseId?: string | null;
  notes?: string | null;
}

export async function createProductionOrder(
  scope: StoreScope, input: CreateProductionOrderInput, userId: string,
): Promise<{ id: string; orderNo: string }> {
  const storeId = scopeForWrite(scope);

  if (input.qtyToProduce <= 0) throw new ManufacturingError('Quantity to produce must be greater than zero.');

  const bom = await db.billOfMaterials.findFirst({
    where: { id: input.bomId, ...scopeWhere(scope) },
    select: { id: true, outputQty: true, isActive: true, finishedProduct: { select: { productName: true } } },
  });
  if (!bom) throw new ManufacturingError('BOM not found in your scope.');
  if (!bom.isActive) throw new ManufacturingError(`The BOM for ${bom.finishedProduct.productName} is inactive. Reactivate it before producing against it.`);
  if (input.qtyToProduce % bom.outputQty !== 0) {
    throw new ManufacturingError(
      `This BOM produces ${bom.outputQty} unit(s) of ${bom.finishedProduct.productName} per run. `
      + `Quantity to produce must be a multiple of ${bom.outputQty}.`,
    );
  }

  const orderNo = await allocateDocumentNumber(storeId, 'MO');

  const order = await db.productionOrder.create({
    data: {
      orderNo,
      storeId,
      bomId: bom.id,
      qtyToProduce: input.qtyToProduce,
      status: 'draft',
      warehouseId: input.warehouseId ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
    },
  });

  return { id: order.id, orderNo };
}

/**
 * Consumes each component's stock and produces the finished good, together,
 * in one step - matching the spec's "light manufacturing" framing. No partial
 * completion: an order either hasn't happened or it has, entirely.
 */
export async function completeProductionOrder(
  scope: StoreScope, id: string, userId: string,
): Promise<{ orderNo: string }> {
  const storeId = scopeForWrite(scope);

  const order = await db.productionOrder.findFirst({
    where: { id, storeId },
    include: {
      bom: {
        include: {
          components: true,
          // Needed to decide what a finished run creates besides quantity: a
          // lot for a batch product, units for a serial one. See below.
          finishedProduct: {
            select: {
              id: true, productCode: true, trackingMode: true,
              tracksExpiry: true, shelfLifeDays: true,
            },
          },
        },
      },
    },
  });
  if (!order) throw new ManufacturingError('Production order not found in your scope.');
  if (order.status === 'completed') throw new ManufacturingError(`${order.orderNo} has already been completed.`);
  if (order.status === 'cancelled') throw new ManufacturingError(`${order.orderNo} has been cancelled.`);

  const scale = order.qtyToProduce / order.bom.outputQty;

  await db.$transaction(async (tx) => {
    const updated = await tx.productionOrder.updateMany({
      where: { id, storeId, status: 'draft' },
      data: { status: 'completed', completedAt: new Date(), completedBy: userId },
    });
    if (updated.count === 0) return;

    await applyMovements(tx, storeId, userId, order.bom.components.map((c) => ({
      productId: c.productId,
      qty: -(c.qty * scale),
      reason: 'production_consume' as const,
      refType: 'ProductionOrder',
      refId: order.id,
      refNo: order.orderNo,
      warehouseId: order.warehouseId,
    })));

    /**
     * WHAT A FINISHED RUN CREATES (3 Oct 2026).
     *
     * Until now: quantity, and nothing else. `manufacturing.ts` created zero
     * `StockLot` rows and zero `StockUnit` rows, so a client who MAKES a
     * batch-tracked product - a small cleaning-products manufacturer, which is
     * exactly the client this is for - could not trace a production run at all.
     * They could record that 500 bottles appeared and never say which batch
     * they were, which is the one thing a recall needs.
     *
     * Now the run is the intake event, the same way a goods receipt is:
     *
     *   batch   one lot per run, numbered after the order (MO-...), with the
     *           expiry derived from the product's shelf life counted from
     *           TODAY - the day it was made, which is what a shelf life means.
     *   serial  one unit per item produced, house-tagged, because a maker
     *           prints their own numbers by definition - there is no vendor
     *           serial to read on something you built.
     */
    const finished = order.bom.finishedProduct;
    let lotId: string | null = null;
    const madeOn = new Date();

    if (finished.trackingMode === 'batch') {
      const lotNo = order.orderNo;
      const existing = await tx.stockLot.findFirst({
        where: { storeId, productId: finished.id, lotNo },
        select: { id: true },
      });
      lotId = existing?.id ?? (await tx.stockLot.create({
        data: {
          storeId,
          productId: finished.id,
          lotNo,
          // No `grnItemId`: this lot was made, not received. Null is the honest
          // answer rather than pointing at a receipt that does not exist.
          mfgDate: madeOn,
          expiryDate: finished.tracksExpiry
            ? deriveExpiry(madeOn, finished.shelfLifeDays)
            : null,
          receivedAt: madeOn,
          createdBy: userId,
        },
        select: { id: true },
      })).id;
    }

    await applyMovements(tx, storeId, userId, [{
      productId: order.bom.finishedProductId,
      qty: order.qtyToProduce,
      reason: 'production_output' as const,
      refType: 'ProductionOrder',
      refId: order.id,
      refNo: order.orderNo,
      warehouseId: order.warehouseId,
      lotId,
    }]);

    if (finished.trackingMode === 'serial') {
      await issueHouseTaggedUnits(tx, storeId, userId, {
        productId: finished.id,
        productCode: finished.productCode,
        count: order.qtyToProduce,
        note: `Made on production order ${order.orderNo}.`,
      });
    }
  });

  return { orderNo: order.orderNo };
}

/**
 * Only from `draft` - nothing has moved yet, so there is nothing to reverse.
 * A completed order represents goods that physically exist now; cancelling it
 * would be pretending a run never happened when its output is already on the
 * shelf, which is a stock adjustment, not a cancellation.
 */
export async function cancelProductionOrder(
  scope: StoreScope, id: string, reason: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new ManufacturingError('Say why this order is being cancelled.');

  const order = await db.productionOrder.findFirst({ where: { id, storeId }, select: { status: true, orderNo: true } });
  if (!order) throw new ManufacturingError('Production order not found in your scope.');
  if (order.status !== 'draft') {
    throw new ManufacturingError(`${order.orderNo} is ${order.status} - only a draft order can be cancelled.`);
  }

  await db.productionOrder.updateMany({
    where: { id, storeId, status: 'draft' },
    data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
  });
}
