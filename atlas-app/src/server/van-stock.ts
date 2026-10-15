import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { applyMovements } from './stock';
import { reconcileVan, type VanLine, type VanReconciliation } from '@/lib/van-reconcile';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Stock a technician is carrying.
 *
 * Pravin's decisions 6 and 7: stock handed over at the start of a shift sits in
 * the VAN LOCATION, has NOT left the business, and has to come back at the end
 * of the day or be accounted for.
 *
 * ---------------------------------------------------------------------------
 * A VAN IS A WAREHOUSE
 *
 * Not a new kind of thing. `ProductBalance` is already keyed on
 * `(productId, warehouseId)` and `StockMovement` already carries a warehouse,
 * so a van gets per-product balances, a full movement history and a place for a
 * serial unit to sit without one line of new ledger code.
 *
 * The alternative - a `VanStock` table - is a second stock ledger with its own
 * balances, its own drift and its own reconciliation against the first. Atlas
 * already has one two-ledger problem (quantity versus identity, see
 * `03-specs/STOCK-IDENTITY-SPEC.md`) and does not need a third on purpose.
 *
 * ---------------------------------------------------------------------------
 * ISSUING MOVES STOCK. IT DOES NOT SELL IT.
 *
 * Every issue writes TWO movements - out of the branch, into the van - which
 * net to zero across the store. That is the whole of decision 6 expressed in
 * the ledger: total stock on hand does not change when a technician loads a
 * van, because nothing has been sold and nothing has left the business. It has
 * only moved, and now somebody's name is against it.
 */

export interface VanSummary {
  id: string;
  name: string;
  code: string;
  holderId: string | null;
  holderName: string | null;
  isActive: boolean;
  /** Distinct products on board. */
  lineCount: number;
  /** Total items, ignoring unit. A rough "is there much on it". */
  itemCount: number;
}

/** Every van in scope, with how much each is carrying. */
export async function listVans(scope: StoreScope): Promise<VanSummary[]> {
  const vans = await db.warehouse.findMany({
    where: { ...scopeWhere(scope), kind: 'van' },
    orderBy: { name: 'asc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, name: true, code: true, holderId: true, isActive: true,
      holder: { select: { fullName: true } },
      // Only what the van is actually holding. A balance row that has fallen to
      // zero is history, not cargo, and listing it would make every van look
      // loaded forever.
      balances: { where: { currentQty: { not: 0 } }, select: { currentQty: true } },
    },
  });

  return vans.map((v) => ({
    id: v.id,
    name: v.name,
    code: v.code,
    holderId: v.holderId,
    holderName: v.holder?.fullName ?? null,
    isActive: v.isActive,
    lineCount: v.balances.length,
    itemCount: v.balances.reduce((t, b) => t + b.currentQty, 0),
  }));
}

/** People who could hold a van. */
export async function vanHolderOptions(scope: StoreScope) {
  return db.user.findMany({
    where: { isActive: true, ...userInScope(scope) },
    orderBy: { fullName: 'asc' },
    take: LIST_MAX_ROWS,
    select: { id: true, fullName: true },
  });
}

export async function createVan(
  scope: StoreScope,
  input: { name: string; code: string; holderId: string | null },
) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name) throw new Error('Give the van a name.');
  if (!code) throw new Error('Give the van a short code.');

  const clash = await db.warehouse.findFirst({
    where: { storeId, code },
    select: { id: true, name: true },
  });
  if (clash) throw new Error(`${code} is already used by ${clash.name}.`);

  return db.warehouse.create({
    data: { storeId, name, code, kind: 'van', holderId: input.holderId },
    select: { id: true, name: true, code: true },
  });
}

export async function setVanHolder(scope: StoreScope, vanId: string, holderId: string | null) {
  const van = await db.warehouse.findFirst({
    where: { id: vanId, ...scopeWhere(scope), kind: 'van' },
    select: { id: true, balances: { where: { currentQty: { not: 0 } }, select: { id: true } } },
  });
  if (!van) throw new Error('Van not found in your scope.');

  /**
   * Refused while the van is loaded.
   *
   * Handing a van over with stock on it makes the new holder answerable for
   * items they never received - and the reconciliation would quietly charge
   * them to the wrong person. Empty it, or hand the stock over as a return and
   * a fresh issue, which leaves a trail.
   */
  if (van.balances.length > 0) {
    throw new Error(
      'This van is still carrying stock. Return it to the branch before changing who holds the van.',
    );
  }

  return db.warehouse.update({ where: { id: vanId }, data: { holderId } });
}

/* -------------------------------------------------------------------------- */
/*  Loading and unloading                                                     */
/* -------------------------------------------------------------------------- */

export interface VanMoveLine {
  productId: string;
  qty: number;
  /** For a serial product: the exact units going out or coming back. */
  stockUnitIds?: string[];
}

/**
 * Is the stock really where the move says it is coming from? (4 Oct 2026)
 *
 * Checked before anything is written, for loading (from the branch) and handing
 * back (from the van):
 *   - the quantity must be there. Loading more than the branch holds would
 *     drive the branch negative to put goods on a van that nobody can see; the
 *     fix for a wrong shelf count is a stock count, not a van load.
 *   - picked serial numbers must be in stock, at that place, of that product.
 *     `issueToVan` moves units by id, so an id from another shelf - or a unit
 *     already sold - would otherwise be quietly relocated.
 *   - a serial product must say WHICH units, as many as are on record there.
 *     Moving the count without the numbers is how a van ends up "holding" four
 *     cameras whose serials the ledger still has on the branch shelf.
 */
async function checkMoveLines(
  scope: StoreScope,
  from: string | null,
  place: string,
  lines: VanMoveLine[],
) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const [products, balances, units] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids }, ...scopeWhere(scope) },
      select: { id: true, productName: true, trackingMode: true },
    }),
    db.productBalance.findMany({
      where: { warehouseId: from, productId: { in: ids }, product: scopeWhere(scope) },
      select: { productId: true, currentQty: true },
    }),
    db.stockUnit.findMany({
      where: { ...scopeWhere(scope), productId: { in: ids }, warehouseId: from, status: 'in_stock' },
      select: { id: true, productId: true },
    }),
  ]);
  const name = (id: string) => products.find((p) => p.id === id)?.productName ?? 'that item';
  if (products.length !== ids.length) throw new Error('One of those products is not in this store.');

  const want = new Map<string, number>();
  for (const l of lines) want.set(l.productId, (want.get(l.productId) ?? 0) + l.qty);
  for (const [productId, qty] of want) {
    const have = balances.find((b) => b.productId === productId)?.currentQty ?? 0;
    if (qty > have) {
      throw new Error(`${place} only has ${Math.max(have, 0)} of ${name(productId)}, so ${qty} cannot go.`);
    }
  }

  for (const l of lines) {
    const here = units.filter((u) => u.productId === l.productId).map((u) => u.id);
    const picked = l.stockUnitIds ?? [];
    if (new Set(picked).size !== picked.length) throw new Error(`The same number is picked twice for ${name(l.productId)}.`);
    if (picked.some((id) => !here.includes(id))) {
      throw new Error(`Some numbers picked for ${name(l.productId)} are not in stock at ${place.toLowerCase()}.`);
    }
    if (picked.length > l.qty) throw new Error(`${picked.length} numbers picked for ${l.qty} of ${name(l.productId)}.`);
    const serial = products.find((p) => p.id === l.productId)?.trackingMode === 'serial';
    const needed = Math.min(l.qty, here.length);
    if (serial && picked.length < needed) {
      throw new Error(`Pick which ${needed} of ${name(l.productId)} are going, by serial number.`);
    }
  }
}

export interface MovableItem {
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string | null;
  trackingMode: string;
  /** How many are at the place being moved FROM. */
  available: number;
  /** Serial units there, so they can be picked by number. */
  units: { id: string; serialNo: string | null }[];
}

/**
 * What can be moved: matching products with stock at the branch (to load) or
 * on the van (to hand back). `code` is a scanned code - product code, barcode
 * or a unit's serial, in which case that unit is returned as `matchedUnitId`.
 * With no search, a van lists everything on board; the branch lists nothing
 * (thousands of lines are not a picker).
 */
export async function vanMovables(
  scope: StoreScope,
  input: { vanId: string; from: 'branch' | 'van'; q?: string | null; code?: string | null },
): Promise<{ items: MovableItem[]; matchedUnitId: string | null }> {
  const van = await vanOrThrow(scope, input.vanId);
  const where = input.from === 'van' ? van.id : null;
  const q = input.q?.trim().slice(0, 80) ?? '';
  const code = input.code?.trim().slice(0, 120) ?? '';

  let productIds: string[] | null = null;
  let matchedUnitId: string | null = null;
  if (code) {
    const unit = await db.stockUnit.findFirst({
      where: { ...scopeWhere(scope), serialNo: { equals: code, mode: 'insensitive' }, warehouseId: where, status: 'in_stock' },
      select: { id: true, productId: true },
    });
    if (unit) { matchedUnitId = unit.id; productIds = [unit.productId]; }
    else {
      productIds = (await db.product.findMany({
        where: { ...scopeWhere(scope), OR: [{ productCode: { equals: code, mode: 'insensitive' } }, { barcode: { equals: code, mode: 'insensitive' } }] },
        select: { id: true }, take: 10,
      })).map((p) => p.id);
    }
  } else if (q.length >= 2) {
    productIds = (await db.product.findMany({
      where: { ...scopeWhere(scope), OR: [
        { productName: { contains: q, mode: 'insensitive' } },
        { productCode: { contains: q, mode: 'insensitive' } },
        { barcode: { equals: q, mode: 'insensitive' } },
      ] },
      select: { id: true }, take: 25,
    })).map((p) => p.id);
  } else if (input.from === 'branch') {
    return { items: [], matchedUnitId: null };
  }

  const balances = await db.productBalance.findMany({
    where: {
      warehouseId: where, currentQty: { gt: 0 },
      ...(productIds ? { productId: { in: productIds } } : {}),
      product: scopeWhere(scope),
    },
    select: {
      productId: true, currentQty: true,
      product: { select: { productName: true, productCode: true, unit: true, trackingMode: true } },
    },
    // A picker of search hits at the branch; everything on board for a van.
    take: input.from === 'van' ? LIST_MAX_ROWS : 25,
  });
  const units = balances.length === 0 ? [] : await db.stockUnit.findMany({
    where: { ...scopeWhere(scope), productId: { in: balances.map((b) => b.productId) }, warehouseId: where, status: 'in_stock' },
    select: { id: true, productId: true, serialNo: true },
    orderBy: { createdAt: 'asc' },
    take: LIST_MAX_ROWS,
  });

  return {
    matchedUnitId,
    items: balances
      .map((b) => ({
        productId: b.productId,
        productName: b.product.productName,
        productCode: b.product.productCode,
        unit: b.product.unit,
        trackingMode: b.product.trackingMode,
        available: b.currentQty,
        units: units.filter((u) => u.productId === b.productId).map((u) => ({ id: u.id, serialNo: u.serialNo })),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName)),
  };
}

async function vanOrThrow(scope: StoreScope, vanId: string) {
  const van = await db.warehouse.findFirst({
    where: { id: vanId, ...scopeWhere(scope), kind: 'van' },
    select: { id: true, name: true, code: true, storeId: true, isActive: true, holderId: true },
  });
  if (!van) throw new Error('Van not found in your scope.');
  if (!van.isActive) throw new Error(`${van.name} is not in service.`);
  return van;
}

/**
 * Branch → van.
 *
 * Two movements per line, netting to zero across the store. Stock on hand does
 * not change, because nothing has been sold; it has moved, and now a name is
 * against it.
 *
 * `unitDestination` is deliberately NOT set. A unit going into a van has not
 * gone to a customer and has not been lost - it is still in stock, on a
 * different shelf - so what changes is its `warehouseId` and nothing else. This
 * is exactly the case the comment on `DEFAULT_DESTINATION` in `server/stock.ts`
 * warns about: binding wrongly is not recoverable, not binding always is.
 */
export async function issueToVan(
  scope: StoreScope,
  input: { vanId: string; fromWarehouseId?: string | null; lines: VanMoveLine[]; note?: string | null },
  userId: string,
) {
  const storeId = scopeForWrite(scope);
  const van = await vanOrThrow(scope, input.vanId);

  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new Error('Nothing to load.');

  const from = input.fromWarehouseId ?? null;
  if (from === van.id) throw new Error('A van cannot load from itself.');
  await checkMoveLines(scope, from, 'The branch', lines);

  const note = input.note?.trim() || `Loaded into ${van.name}`;

  return db.$transaction(async (tx) => {
    await applyMovements(tx, storeId, userId, [
      ...lines.map((l) => ({
        productId: l.productId,
        qty: -l.qty,
        reason: 'van_issue' as const,
        warehouseId: from,
        refType: 'Van',
        refId: van.id,
        refNo: van.code,
        note,
        stockUnitIds: l.stockUnitIds,
      })),
      ...lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        reason: 'van_issue' as const,
        warehouseId: van.id,
        refType: 'Van',
        refId: van.id,
        refNo: van.code,
        note,
      })),
    ]);

    /**
     * The units follow the quantity.
     *
     * Their status stays `in_stock` on purpose - a camera in a van is neither
     * sold nor lost - and only `warehouseId` changes, so Product History can
     * answer "where is this one" with "in Tikam's van" rather than "somewhere".
     */
    const unitIds = lines.flatMap((l) => l.stockUnitIds ?? []);
    if (unitIds.length > 0) {
      await tx.stockUnit.updateMany({
        where: { id: { in: unitIds }, storeId },
        data: { warehouseId: van.id },
      });
    }

    return { vanId: van.id, vanName: van.name, lines: lines.length };
  });
}

/**
 * Van → branch.
 *
 * The mirror of loading, and refused beyond what the van is holding: a van
 * cannot hand back six cameras when the ledger says it has four, and allowing
 * it would create stock out of nothing.
 */
export async function returnFromVan(
  scope: StoreScope,
  input: { vanId: string; toWarehouseId?: string | null; lines: VanMoveLine[]; note?: string | null },
  userId: string,
) {
  const storeId = scopeForWrite(scope);
  const van = await vanOrThrow(scope, input.vanId);

  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new Error('Nothing to hand back.');

  await checkMoveLines(scope, van.id, van.name, lines);

  const to = input.toWarehouseId ?? null;
  const note = input.note?.trim() || `Returned from ${van.name}`;

  return db.$transaction(async (tx) => {
    await applyMovements(tx, storeId, userId, [
      ...lines.map((l) => ({
        productId: l.productId,
        qty: -l.qty,
        reason: 'van_return' as const,
        warehouseId: van.id,
        refType: 'Van',
        refId: van.id,
        refNo: van.code,
        note,
        stockUnitIds: l.stockUnitIds,
      })),
      ...lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        reason: 'van_return' as const,
        warehouseId: to,
        refType: 'Van',
        refId: van.id,
        refNo: van.code,
        note,
      })),
    ]);

    const unitIds = lines.flatMap((l) => l.stockUnitIds ?? []);
    if (unitIds.length > 0) {
      await tx.stockUnit.updateMany({
        where: { id: { in: unitIds }, storeId },
        data: { warehouseId: to },
      });
    }

    return { vanId: van.id, vanName: van.name, lines: lines.length };
  });
}

/* -------------------------------------------------------------------------- */
/*  Does it add up?                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The shift, read back out of the movement ledger.
 *
 * Everything here is DERIVED. There is no "van trip" row recording what was
 * issued, because a stored tally is the same failure mode as a stored balance:
 * it drifts the first time somebody corrects a movement, and then two numbers
 * disagree with nobody able to say which is right. The movements are the truth
 * and this reads them.
 *
 * `since` is the start of the shift. Default: the last midnight in India, which
 * is what "today" means to the person asking.
 */
export async function vanShift(
  scope: StoreScope,
  vanId: string,
  since?: Date,
): Promise<{ van: { id: string; name: string; code: string; holderName: string | null }; result: VanReconciliation }> {
  const van = await db.warehouse.findFirst({
    where: { id: vanId, ...scopeWhere(scope), kind: 'van' },
    select: { id: true, name: true, code: true, holder: { select: { fullName: true } } },
  });
  if (!van) throw new Error('Van not found in your scope.');

  const from = since ?? startOfIndianDay();

  const [balances, movements] = await Promise.all([
    db.productBalance.findMany({
      // Scoped through the product - see the note in `returnFromVan`.
      where: { warehouseId: van.id, product: scopeWhere(scope) },
      select: {
        productId: true, currentQty: true,
        product: { select: { productName: true, unit: true } },
      },
    }),
    db.stockMovement.findMany({
      where: { ...scopeWhere(scope), warehouseId: van.id, createdAt: { gte: from } },
      select: { productId: true, qty: true, reason: true },
    }),
  ]);

  const byProduct = new Map<string, VanLine>();
  const seed = (productId: string, name: string, unit: string | null) => {
    let l = byProduct.get(productId);
    if (!l) {
      l = {
        productId, productName: name, unit,
        openingQty: 0, issuedQty: 0, usedQty: 0, returnedQty: 0, onVanQty: 0,
      };
      byProduct.set(productId, l);
    }
    return l;
  };

  for (const b of balances) {
    const l = seed(b.productId, b.product.productName, b.product.unit);
    l.onVanQty = b.currentQty;
  }

  const names = new Map<string, { productName: string; unit: string | null }>();
  const unknown = [...new Set(movements.map((m) => m.productId))]
    .filter((id) => !byProduct.has(id));
  if (unknown.length > 0) {
    for (const p of await db.product.findMany({
      where: { id: { in: unknown }, ...scopeWhere(scope) },
      select: { id: true, productName: true, unit: true },
    })) names.set(p.id, { productName: p.productName, unit: p.unit });
  }

  for (const m of movements) {
    const known = names.get(m.productId);
    const l = seed(m.productId, known?.productName ?? 'Unknown product', known?.unit ?? null);
    if (m.reason === 'van_issue' && m.qty > 0) l.issuedQty += m.qty;
    else if (m.reason === 'van_return' && m.qty < 0) l.returnedQty += -m.qty;
    // Anything else leaving the van went to a customer: a job issue, a
    // dispatch, a replacement. Counting it by exclusion rather than by listing
    // reasons means a reason added next year is counted rather than silently
    // dropped into the shortfall.
    else if (m.qty < 0) l.usedQty += -m.qty;
  }

  /**
   * Opening is worked BACKWARDS from where the van is now.
   *
   * on hand = opening + issued − used − returned, so opening is whatever makes
   * that true. Reading it forwards would mean replaying the van's entire
   * history from the day it was created, every time somebody opens the screen.
   */
  for (const l of byProduct.values()) {
    l.openingQty = l.onVanQty - l.issuedQty + l.usedQty + l.returnedQty;
  }

  return {
    van: { id: van.id, name: van.name, code: van.code, holderName: van.holder?.fullName ?? null },
    result: reconcileVan([...byProduct.values()].sort((a, b) =>
      a.productName.localeCompare(b.productName))),
  };
}

/**
 * Write off what a van cannot account for.
 *
 * Deliberately a separate, deliberate act rather than something the end of a
 * shift does automatically. A shortfall that disappears on its own teaches
 * everybody that shortfalls do not matter; one that sits on the screen until a
 * named person closes it with a reason is the whole point of counting.
 */
export async function writeOffVanShortfall(
  scope: StoreScope,
  input: { vanId: string; lines: { productId: string; qty: number }[]; reason: string },
  userId: string,
) {
  const storeId = scopeForWrite(scope);
  const van = await vanOrThrow(scope, input.vanId);
  const reason = input.reason.trim();
  if (!reason) throw new Error('Say what happened to it. A write-off with no reason is a gap.');

  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new Error('Nothing to write off.');

  return db.$transaction(async (tx) => {
    await applyMovements(tx, storeId, userId, lines.map((l) => ({
      productId: l.productId,
      qty: -l.qty,
      reason: 'van_shortfall' as const,
      warehouseId: van.id,
      refType: 'Van',
      refId: van.id,
      refNo: van.code,
      note: `${van.name}: ${reason}`,
      // Units are not bound. Which physical cameras went missing is exactly
      // what nobody knows - that is what a shortfall means - and guessing would
      // mark the wrong serials lost.
    })));
    return { lines: lines.length };
  });
}

/** Midnight today, Indian time, as a UTC instant. */
function startOfIndianDay(): Date {
  const now = new Date();
  // +05:30. India has no daylight saving, so a fixed offset is correct and a
  // timezone library would buy nothing here.
  const india = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  india.setUTCHours(0, 0, 0, 0);
  return new Date(india.getTime() - 5.5 * 60 * 60 * 1000);
}
