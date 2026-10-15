import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { applyMovements, type MovementReason } from './stock';
import { serialsAlreadyOnFile } from './goods-receipt';
import { planReceiptLine } from '@/lib/stock-intake';
import { completeLineSerials } from '@/lib/house-tag';
import { STOCK_IN_REASONS, type StockInReason } from '@/lib/stock-in';

/**
 * STOCK IN BY SCAN, WITHOUT A SUPPLIER (Scan-to-Stock G6, 12 Oct 2026).
 *
 * Opening stock, stock found in a count, a transfer in. "Adjust stock" could
 * only type a number, and for a serial product it issued house tags - the
 * real serials on the boxes were never recorded, so a warranty claim later
 * quoted a serial Atlas had never seen. Here every box is scanned: the same
 * line rules as a goods receipt (lib/stock-intake), serials checked against
 * each other and against units already on file, a box with no readable serial
 * gets a house tag, and the reason is recorded on every movement and unit.
 *
 * All or nothing in one transaction.
 */

export class StockInError extends Error {}

export interface StockInLine {
  productId: string;
  qty: number;
  serials?: string[];
  noSerial?: number;
  lotNo?: string | null;
  /** Optional - the product's current buying price is used when blank. */
  unitCostPaise?: number | null;
}

const MOVEMENT: Record<StockInReason, MovementReason> = {
  opening: 'opening', found: 'adjustment', transfer_in: 'adjustment', other: 'adjustment',
};

export async function stockInByScan(
  scope: StoreScope,
  input: { reason: string; note: string | null; lines: StockInLine[] },
  userId: string,
): Promise<{ ref: string; qty: number; units: number; houseTags: string[] }> {
  const storeId = scopeForWrite(scope);
  if (!(input.reason in STOCK_IN_REASONS)) throw new StockInError('Choose why this stock is coming in.');
  const reason = input.reason as StockInReason;
  if (reason === 'other' && !input.note?.trim()) throw new StockInError('Say where this stock came from.');
  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new StockInError('Scan or add at least one item.');

  const products = new Map((await db.product.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.productId))] }, ...scopeWhere(scope) },
    select: {
      id: true, productCode: true, productName: true, trackingMode: true,
      prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { costPaise: true } },
    },
  })).map((p) => [p.id, p]));

  const planned = lines.map((l) => {
    const p = products.get(l.productId);
    if (!p) throw new StockInError('A product on this list is not in this store.');
    const plan = planReceiptLine({
      productName: p.productName, trackingMode: p.trackingMode, qty: l.qty,
      capture: 'serials', serials: l.serials ?? [], noSerial: l.noSerial ?? 0, lotNo: l.lotNo ?? null,
    });
    if (!plan.ok) throw new StockInError(plan.reason);
    return { l, p, plan };
  });

  const wanted = planned.flatMap(({ l, plan }) => plan.units.filter((s): s is string => !!s).map((serial) => ({ productId: l.productId, serial })));
  const seen = new Set<string>();
  for (const w of wanted) {
    const k = `${w.productId}|${w.serial.toUpperCase()}`;
    if (seen.has(k)) throw new StockInError(`Serial ${w.serial} is on this list twice.`);
    seen.add(k);
  }
  const taken = await serialsAlreadyOnFile(storeId, wanted);
  if (taken.length > 0) throw new StockInError(`Already on file: ${taken.slice(0, 5).join(', ')}. A serial can only come in once.`);

  const now = new Date();
  // Dated in India time, like every other day Atlas shows (the server runs in UTC).
  const indiaDay = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const ref = `STOCKIN-${indiaDay}-${now.getTime().toString(36).slice(-4).toUpperCase()}`;
  const label = STOCK_IN_REASONS[reason];
  const note = [label, input.note?.trim()].filter(Boolean).join(' - ');
  const houseTags: string[] = [];
  let unitCount = 0;

  await db.$transaction(async (tx) => {
    for (const { l, p, plan } of planned) {
      if (!plan.movesStock) continue;
      const cost = l.unitCostPaise ?? p.prices[0]?.costPaise ?? 0;
      let lotId: string | null = null;
      if (p.trackingMode === 'batch' && plan.lotNo) {
        const existing = await tx.stockLot.findFirst({ where: { storeId, productId: p.id, lotNo: plan.lotNo }, select: { id: true } });
        lotId = existing?.id ?? (await tx.stockLot.create({
          data: { storeId, productId: p.id, lotNo: plan.lotNo, unitCostPaise: cost, receivedAt: now, createdBy: userId },
          select: { id: true },
        })).id;
      }
      await applyMovements(tx, storeId, userId, [{
        productId: p.id, qty: l.qty, reason: MOVEMENT[reason], refType: 'StockIn', refNo: ref, lotId, note,
      }]);

      if (p.trackingMode === 'serial') {
        const existing = (await tx.stockUnit.findMany({ where: { storeId, productId: p.id }, select: { serialNo: true } })).map((u) => u.serialNo);
        const identities = completeLineSerials({ productCode: p.productCode, qty: l.qty, typed: plan.units, at: now, existingSerials: existing });
        const created = await tx.stockUnit.createManyAndReturn({
          data: identities.map((i) => ({
            storeId, productId: p.id, serialNo: i.serialNo, identitySource: i.identitySource,
            status: 'in_stock', condition: 'new', unitCostPaise: cost, receivedAt: now, createdBy: userId,
          })),
          select: { id: true, serialNo: true, identitySource: true },
        });
        await tx.stockUnitEvent.createMany({
          data: created.map((u) => ({
            storeId, unitId: u.id, eventType: 'received', toStatus: 'in_stock', toCondition: 'new',
            refType: 'StockIn', refNo: ref,
            note: u.identitySource === 'house' ? `${note}. No readable serial - Atlas issued this number; print and stick it.` : note,
            createdBy: userId,
          })),
        });
        houseTags.push(...created.filter((u) => u.identitySource === 'house').map((u) => u.serialNo ?? '').filter(Boolean));
        unitCount += created.length;
      }
    }
  }, { timeout: 60_000 });

  return { ref, qty: lines.reduce((n, l) => n + l.qty, 0), units: unitCount, houseTags };
}
