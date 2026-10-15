import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { applyMovements } from './stock';
import { resolveCoverageFor } from './amc';
import { serialsAlreadyOnFile } from './goods-receipt';
import { LIST_MAX_ROWS, FEED_MAX_ROWS } from '@/lib/list-limits';
import type { Coverage } from '@/lib/amc-coverage';
import { warrantyUntil } from '@/lib/amc-coverage';
import {
  isOnShelf, planUnitTransition, reconcileSerialStock, supplierWarrantyUntil,
  unitWarrantyMonths, warrantyStart, UNIT_CONDITIONS,
} from '@/lib/stock-units';
import { parseSerialList, planOpeningStock, type OpeningPlan } from '@/lib/stock-intake';
import {
  fieldKeyFromLabel, fieldsForCategory, validateFieldDef, validateStockFieldValues,
  type StockFieldDef,
} from '@/lib/stock-fields';

/**
 * Serialised stock: one row per physical unit, and everything that happens to it.
 *
 * All the judgement - which state may follow which, what a move does to the
 * stock count, when a warranty starts, whether a set of custom values is
 * acceptable - lives in lib/ (stock-units, stock-intake, stock-fields) as pure
 * tested functions. This file reads and writes rows, the part that cannot be
 * pure, and follows two rules from the ledger:
 *
 *   1. A unit that leaves or returns to the shelf writes a stock movement in
 *      the same transaction, sized by `planUnitTransition`. So the quantity on
 *      hand and the units on the shelf are moved by the same act.
 *   2. Nothing computable is stored. Warranty expiry, AMC cover, supplier and
 *      supplier invoice number are all read through, never copied.
 *
 * Coverage is answered by `resolveCoverageFor` in server/amc - the same rule
 * the Complaint Tracker uses. There is one coverage path, not two.
 */

export class StockUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockUnitError';
  }
}

const partyName = (p: {
  title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null;
}) => p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();

const PARTY_SELECT = { id: true, title: true, firstName: true, lastName: true, companyName: true } as const;

/* -------------------------------------------------------------------- rows */

export interface UnitRow {
  id: string;
  serialNo: string | null;
  productId: string;
  productName: string;
  productCode: string;
  categoryId: string | null;
  status: string;
  condition: string;
  holderId: string | null;
  holderName: string | null;
  receivedAt: Date;
  grnNo: string | null;
  supplierName: string | null;
  unitCostPaise: number | null;
  legacyRef: string | null;
}

const ROW_SELECT = {
  id: true, serialNo: true, productId: true, status: true, condition: true,
  partyId: true, receivedAt: true, unitCostPaise: true, legacyRef: true,
  product: { select: { productName: true, productCode: true, categoryId: true } },
  party: { select: PARTY_SELECT },
  grnItem: { select: { grn: { select: { grnNo: true, supplierName: true } } } },
} satisfies Prisma.StockUnitSelect;

type RowShape = Prisma.StockUnitGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(u: RowShape): UnitRow {
  return {
    id: u.id,
    serialNo: u.serialNo,
    productId: u.productId,
    productName: u.product.productName,
    productCode: u.product.productCode,
    categoryId: u.product.categoryId,
    status: u.status,
    condition: u.condition,
    holderId: u.partyId,
    holderName: u.party ? partyName(u.party) : null,
    receivedAt: u.receivedAt,
    grnNo: u.grnItem?.grn.grnNo ?? null,
    supplierName: u.grnItem?.grn.supplierName ?? null,
    unitCostPaise: u.unitCostPaise,
    legacyRef: u.legacyRef,
  };
}

/** Every unit in scope, for the pools grid. Scrapped units included - they are history. */
export async function listUnits(scope: StoreScope): Promise<UnitRow[]> {
  const rows = await db.stockUnit.findMany({
    where: scopeWhere(scope),
    select: ROW_SELECT,
    orderBy: { receivedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map(toRow);
}

/**
 * Find a unit by what somebody typed or scanned.
 *
 * Exact first, case-insensitively - a scanner and a person typing the same
 * label disagree on case. Then a contains match, so a technician reading the
 * last six digits off a dusty label still gets an answer. The same serial can
 * legitimately exist under two products (two manufacturers' numbering), so
 * this returns a list rather than pretending there is one answer.
 */
export async function findUnitsBySerial(scope: StoreScope, query: string): Promise<UnitRow[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const exact = await db.stockUnit.findMany({
    where: { ...scopeWhere(scope), serialNo: { equals: q, mode: 'insensitive' } },
    select: ROW_SELECT,
    take: 20,
  });
  if (exact.length > 0) return exact.map(toRow);
  const near = await db.stockUnit.findMany({
    where: { ...scopeWhere(scope), serialNo: { contains: q, mode: 'insensitive' } },
    select: ROW_SELECT,
    orderBy: { receivedAt: 'desc' },
    take: 20,
  });
  return near.map(toRow);
}

/* ------------------------------------------------------------------ detail */

export interface UnitDetail extends UnitRow {
  note: string | null;
  customFields: Record<string, unknown>;
  unitWarrantyMonths: number | null;
  productWarrantyMonths: number | null;
  /** The months that actually apply - the unit's override, else the product's. */
  warrantyMonths: number | null;
  invoice: { id: string; invoiceNo: string; invoiceDate: Date } | null;
  install: { id: string; challanNo: string; dispatchedAt: Date; completedAt: Date | null } | null;
  /** Which date the store counts warranty from, and the date it gave. */
  warrantyBasis: string;
  warrantyStartsOn: Date | null;
  warrantyUntil: Date | null;
  /** The supplier's warranty to us - can this go back. */
  supplier: {
    grnId: string; grnNo: string; supplierName: string; supplierInvoiceNo: string | null;
    receivedAt: Date; warrantyMonths: number | null; warrantyUntil: Date | null;
  } | null;
  /** Who pays if it breaks today. Only asked when a customer holds it. */
  coverage: Coverage | null;
  complaints: { id: string; complaintNo: string; status: string; createdAt: Date; description: string }[];
  events: {
    id: string; eventType: string; fromStatus: string | null; toStatus: string | null;
    fromCondition: string | null; toCondition: string | null; partyName: string | null;
    refType: string | null; refNo: string | null; note: string | null; createdAt: Date; byName: string | null;
  }[];
}

/** `Store.warrantyStartsOn`, or the default in All Company where there is no single answer. */
export async function getWarrantyBasis(scope: StoreScope): Promise<string> {
  if (scope.kind === 'all') return 'invoice';
  const s = await db.store.findUnique({ where: { id: scope.storeId }, select: { warrantyStartsOn: true } });
  return s?.warrantyStartsOn ?? 'invoice';
}

export async function setWarrantyBasis(scope: StoreScope, basis: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (basis !== 'invoice' && basis !== 'install') {
    throw new StockUnitError('Warranty starts on the invoice date or the installation date.');
  }
  await db.store.update({ where: { id: storeId }, data: { warrantyStartsOn: basis } });
}

export async function getUnitDetail(scope: StoreScope, id: string): Promise<UnitDetail> {
  const u = await db.stockUnit.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      ...ROW_SELECT,
      note: true, customFields: true, warrantyMonths: true, warrantyFrom: true, storeId: true,
      product: { select: { productName: true, productCode: true, categoryId: true, warrantyMonths: true } },
      invoice: { select: { id: true, invoiceNo: true, invoiceDate: true } },
      grnItem: {
        select: {
          warrantyMonths: true,
          grn: { select: { id: true, grnNo: true, supplierName: true, supplierInvoiceNo: true, receivedDate: true } },
        },
      },
      challanItems: {
        select: { challan: { select: { id: true, challanNo: true, dispatchedAt: true, completedAt: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      events: {
        orderBy: { createdAt: 'desc' },
        take: FEED_MAX_ROWS,
        select: {
          id: true, eventType: true, fromStatus: true, toStatus: true, fromCondition: true,
          toCondition: true, partyId: true, refType: true, refNo: true, note: true,
          createdAt: true, createdBy: true,
        },
      },
    },
  });
  if (!u) throw new StockUnitError('That unit is not in your scope.');

  const basis = await getWarrantyBasis(scope);
  const install = u.challanItems[0]?.challan ?? null;
  const startsOn = warrantyStart({
    basis,
    invoiceDate: u.invoice?.invoiceDate ?? null,
    installDate: install ? (install.completedAt ?? install.dispatchedAt) : null,
    restartedOn: u.warrantyFrom,
  });
  const months = unitWarrantyMonths(u.warrantyMonths, u.product.warrantyMonths);

  const heldByCustomer = u.status === 'with_customer' && u.partyId;
  const coverage = heldByCustomer
    ? await resolveCoverageFor(scope, {
      customerId: u.partyId!,
      productId: u.productId,
      equipment: { soldOn: startsOn, warrantyMonths: months },
    })
    : null;

  // Complaints against this product at this customer since it went to them.
  // Complaints carry a product and a customer rather than a unit, so this is
  // the honest reach: every complaint that could be about this unit.
  const complaints = heldByCustomer
    ? await db.complaint.findMany({
      where: {
        ...scopeWhere(scope),
        customerId: u.partyId!,
        productId: u.productId,
        ...(startsOn ? { createdAt: { gte: startsOn } } : {}),
      },
      select: { id: true, complaintNo: true, status: true, createdAt: true, description: true },
      orderBy: { createdAt: 'desc' },
      take: FEED_MAX_ROWS,
    })
    : [];

  const [eventParties, eventUsers] = await Promise.all([
    db.party.findMany({
      where: { ...scopeWhere(scope), id: { in: u.events.map((e) => e.partyId).filter((x): x is string => !!x) } },
      select: PARTY_SELECT,
    }),
    db.user.findMany({
      where: { ...userInScope(scope), id: { in: u.events.map((e) => e.createdBy).filter((x): x is string => !!x) } },
      select: { id: true, fullName: true },
    }),
  ]);
  const pName = new Map(eventParties.map((p) => [p.id, partyName(p)]));
  const uName = new Map(eventUsers.map((x) => [x.id, x.fullName]));

  const grn = u.grnItem?.grn ?? null;

  return {
    ...toRow(u),
    note: u.note,
    customFields: (u.customFields as Record<string, unknown> | null) ?? {},
    unitWarrantyMonths: u.warrantyMonths,
    productWarrantyMonths: u.product.warrantyMonths,
    warrantyMonths: months,
    invoice: u.invoice,
    install,
    warrantyBasis: basis,
    warrantyStartsOn: startsOn,
    warrantyUntil: warrantyUntil({ productId: u.productId, soldOn: startsOn, warrantyMonths: months }),
    supplier: grn ? {
      grnId: grn.id,
      grnNo: grn.grnNo,
      supplierName: grn.supplierName,
      supplierInvoiceNo: grn.supplierInvoiceNo,
      receivedAt: grn.receivedDate,
      warrantyMonths: u.grnItem!.warrantyMonths,
      warrantyUntil: supplierWarrantyUntil(grn.receivedDate, u.grnItem!.warrantyMonths),
    } : null,
    coverage,
    complaints,
    events: u.events.map((e) => ({
      id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus,
      fromCondition: e.fromCondition, toCondition: e.toCondition,
      partyName: e.partyId ? pName.get(e.partyId) ?? null : null,
      refType: e.refType, refNo: e.refNo, note: e.note, createdAt: e.createdAt,
      byName: e.createdBy ? uName.get(e.createdBy) ?? null : null,
    })),
  };
}

/* ------------------------------------------------------------------- writes */

async function unitForWrite(storeId: string, id: string) {
  const u = await db.stockUnit.findFirst({
    where: { id, storeId },
    select: {
      id: true, productId: true, serialNo: true, status: true, condition: true, partyId: true,
      invoiceId: true, customFields: true, product: { select: { categoryId: true, productName: true } },
    },
  });
  if (!u) throw new StockUnitError('That unit is not in your scope.');
  return u;
}

export interface MoveUnitInput {
  to: string;
  /** The customer or supplier it goes to, when the new state needs one. */
  partyId?: string | null;
  /** The invoice that sold it. Its own movement already took the stock off. */
  invoiceId?: string | null;
  /** Change condition on the way - e.g. back from the supplier, refurbished. */
  condition?: string | null;
  note?: string | null;
}

/**
 * Move a unit to a new state, and the stock count with it.
 *
 * The movement is written from `planUnitTransition`'s `stockDelta` inside the
 * same transaction as the status change, with reason `unit_status`, so every
 * unit that left the shelf is a row on the ledger that names it.
 *
 * Linking an INVOICE is the one case that moves nothing: the invoice took the
 * goods off when it was created, and this only records which unit it was.
 */
export async function moveUnit(
  scope: StoreScope,
  id: string,
  input: MoveUnitInput,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const u = await unitForWrite(storeId, id);

  let invoice: { id: string; invoiceNo: string; partyId: string | null } | null = null;
  if (input.invoiceId) {
    invoice = await db.invoice.findFirst({
      where: { id: input.invoiceId, storeId },
      select: { id: true, invoiceNo: true, partyId: true },
    });
    if (!invoice) throw new StockUnitError('That invoice is not in your scope.');
    if (input.to !== 'with_customer') throw new StockUnitError('An invoice can only be linked when the unit goes to a customer.');
  }

  const partyId = input.partyId || invoice?.partyId || null;
  const plan = planUnitTransition({ from: u.status, to: input.to, partyId, stockAlreadyMoved: !!invoice });
  if (!plan.ok) throw new StockUnitError(plan.reason);

  if (plan.partyId) {
    const party = await db.party.findFirst({ where: { id: plan.partyId, storeId }, select: { id: true } });
    if (!party) throw new StockUnitError('That customer or supplier is not in your scope.');
  }

  const condition = input.condition && input.condition !== u.condition ? input.condition : null;
  if (condition && !(UNIT_CONDITIONS as readonly string[]).includes(condition)) {
    throw new StockUnitError(`Unknown condition "${condition}".`);
  }

  await db.$transaction(async (tx) => {
    await tx.stockUnit.update({
      where: { id: u.id },
      data: {
        status: input.to,
        partyId: plan.partyId,
        // Back on the shelf means it is no longer sold to anyone.
        invoiceId: invoice ? invoice.id : isOnShelf(input.to) ? null : u.invoiceId,
        ...(condition ? { condition } : {}),
      },
    });

    if (plan.stockDelta !== 0) {
      await applyMovements(tx, storeId, userId, [{
        productId: u.productId,
        qty: plan.stockDelta,
        reason: 'unit_status',
        refType: 'StockUnit',
        refId: u.id,
        refNo: u.serialNo ?? undefined,
        stockUnitId: u.id,
        note: input.note?.trim() || undefined,
      }]);
    }

    await tx.stockUnitEvent.create({
      data: {
        storeId,
        unitId: u.id,
        eventType: 'status',
        fromStatus: u.status,
        toStatus: input.to,
        ...(condition ? { fromCondition: u.condition, toCondition: condition } : {}),
        partyId: plan.partyId,
        refType: invoice ? 'Invoice' : null,
        refId: invoice?.id ?? null,
        refNo: invoice?.invoiceNo ?? null,
        note: input.note?.trim() || null,
        createdBy: userId,
      },
    });
  });
}

/** Mark a unit new or refurbished without moving it - e.g. repaired in-house. */
export async function setUnitCondition(
  scope: StoreScope, id: string, condition: string, note: string | null, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const u = await unitForWrite(storeId, id);
  if (!(UNIT_CONDITIONS as readonly string[]).includes(condition)) {
    throw new StockUnitError(`Unknown condition "${condition}".`);
  }
  if (condition === u.condition) return;
  await db.$transaction([
    db.stockUnit.update({ where: { id: u.id }, data: { condition } }),
    db.stockUnitEvent.create({
      data: {
        storeId, unitId: u.id, eventType: 'condition',
        fromCondition: u.condition, toCondition: condition,
        note: note?.trim() || null, createdBy: userId,
      },
    }),
  ]);
}

/**
 * Set or correct one unit's serial. The usual case is a placeholder getting
 * the serial that was "to follow"; the history keeps the old value, so a
 * corrected typo is still visible as a correction.
 */
export async function setUnitSerial(
  scope: StoreScope, id: string, serialNo: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const u = await unitForWrite(storeId, id);
  const { serials, tooLong } = parseSerialList(serialNo);
  if (tooLong.length > 0 || serials.length !== 1) throw new StockUnitError('Enter exactly one serial.');
  const serial = serials[0];
  if (serial === u.serialNo) return;

  const taken = (await serialsAlreadyOnFile(storeId, [{ productId: u.productId, serial }]))
    .filter((s) => s !== u.serialNo);
  if (taken.length > 0) throw new StockUnitError(`${taken[0]} is already on file for ${u.product.productName}.`);

  await db.$transaction([
    db.stockUnit.update({ where: { id: u.id }, data: { serialNo: serial } }),
    db.stockUnitEvent.create({
      data: {
        storeId, unitId: u.id, eventType: 'serial',
        note: u.serialNo ? `Serial corrected from ${u.serialNo} to ${serial}` : `Serial recorded: ${serial}`,
        createdBy: userId,
      },
    }),
  ]);
}

/**
 * "Serials to follow" - they followed. Paste them, and they go onto this
 * product's placeholders, oldest arrival first. Refuses more serials than
 * there are placeholders rather than creating units that never arrived.
 */
export async function fillPlaceholders(
  scope: StoreScope, productId: string, text: string, userId: string,
): Promise<{ filled: number; remaining: number }> {
  const storeId = scopeForWrite(scope);
  const { serials, duplicates, tooLong } = parseSerialList(text);
  if (tooLong.length > 0) throw new StockUnitError(`"${tooLong[0].slice(0, 24)}..." is too long to be one serial.`);
  if (duplicates.length > 0) throw new StockUnitError(`${duplicates.join(', ')} appears more than once.`);
  if (serials.length === 0) throw new StockUnitError('Paste at least one serial.');

  const placeholders = await db.stockUnit.findMany({
    where: { storeId, productId, serialNo: null, status: { not: 'scrapped' } },
    select: { id: true },
    orderBy: { receivedAt: 'asc' },
  });
  if (serials.length > placeholders.length) {
    throw new StockUnitError(
      `${serials.length} serials but only ${placeholders.length} unit${placeholders.length === 1 ? '' : 's'} waiting for one.`,
    );
  }

  const taken = await serialsAlreadyOnFile(storeId, serials.map((serial) => ({ productId, serial })));
  if (taken.length > 0) throw new StockUnitError(`Already on file: ${taken.slice(0, 5).join(', ')}.`);

  await db.$transaction(async (tx) => {
    for (let i = 0; i < serials.length; i += 1) {
      await tx.stockUnit.update({ where: { id: placeholders[i].id }, data: { serialNo: serials[i] } });
    }
    await tx.stockUnitEvent.createMany({
      data: serials.map((s, i) => ({
        storeId, unitId: placeholders[i].id, eventType: 'serial',
        note: `Serial recorded: ${s}`, createdBy: userId,
      })),
    });
  });

  return { filled: serials.length, remaining: placeholders.length - serials.length };
}

/** Save a unit's custom field values, checked against this store's field config. */
export async function saveUnitFields(
  scope: StoreScope, id: string, input: Record<string, unknown>, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const u = await unitForWrite(storeId, id);
  const all = await listStockFields(scope);
  const { values, errors } = validateStockFieldValues(
    fieldsForCategory(all, u.product.categoryId),
    all,
    input,
    (u.customFields as Record<string, unknown> | null) ?? {},
  );
  if (errors.length > 0) throw new StockUnitError(errors.join(' '));

  await db.$transaction([
    db.stockUnit.update({ where: { id: u.id }, data: { customFields: values as Prisma.InputJsonValue } }),
    db.stockUnitEvent.create({
      data: { storeId, unitId: u.id, eventType: 'fields', note: 'Details updated', createdBy: userId },
    }),
  ]);
}

/* ----------------------------------------------------------- reconciliation */

export interface SerialGap {
  productId: string;
  productName: string;
  productCode: string;
  /**
   * So the screen can narrow 93 rows to the ones somebody is responsible for.
   * A list this long with no way to cut it is a list nobody works through.
   */
  categoryId: string | null;
  categoryName: string | null;
  subCategoryId: string | null;
  subCategoryName: string | null;
  onHand: number;
  unitsOnShelf: number;
  difference: number;
  message: string;
}

/**
 * Serial products where the quantity ledger and the unit table disagree.
 *
 * Not corrected here - a "count only" receipt creates exactly this gap on
 * purpose. Listed so somebody can see it and close it the right way; see
 * lib/stock-units `reconcileSerialStock` for which way is which.
 */
export async function serialStockGaps(scope: StoreScope): Promise<SerialGap[]> {
  const [products, shelf] = await Promise.all([
    db.product.findMany({
      where: { ...scopeWhere(scope), trackingMode: 'serial' },
      select: {
        id: true, productName: true, productCode: true,
        categoryId: true, subCategoryId: true,
        category: { select: { name: true } },
        subCategory: { select: { name: true } },
        balances: { select: { currentQty: true } },
      },
      take: LIST_MAX_ROWS,
    }),
    db.stockUnit.groupBy({
      by: ['productId'],
      where: { ...scopeWhere(scope), status: { in: ['in_stock', 'reserved'] } },
      _count: { _all: true },
    }),
  ]);
  const onShelf = new Map(shelf.map((s) => [s.productId, s._count._all]));

  const gaps: SerialGap[] = [];
  for (const p of products) {
    const onHand = p.balances.reduce((n, b) => n + b.currentQty, 0);
    const units = onShelf.get(p.id) ?? 0;
    const r = reconcileSerialStock(onHand, units);
    if (!r.matches) {
      gaps.push({
        productId: p.id, productName: p.productName, productCode: p.productCode,
        categoryId: p.categoryId, categoryName: p.category?.name ?? null,
        subCategoryId: p.subCategoryId, subCategoryName: p.subCategory?.name ?? null,
        onHand, unitsOnShelf: units, difference: r.difference, message: r.message!,
      });
    }
  }
  return gaps.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/* ------------------------------------------------------------ opening stock */

/**
 * Plan an opening-stock import against this store's catalogue. Writes nothing.
 * The screen shows this, and only an error-free plan may be committed.
 */
export async function planOpeningImport(scope: StoreScope, csvText: string): Promise<OpeningPlan> {
  const products = await db.product.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    select: { id: true, productCode: true, productName: true, trackingMode: true },
    take: LIST_MAX_ROWS,
  });
  return planOpeningStock(csvText, products);
}

/**
 * Bring in what a client already holds on the day they start.
 *
 * Every future client arrives with an empty system, so this is a product
 * requirement rather than a migration convenience. Movements carry reason
 * `opening` and refType `OpeningStock`: counted by a person, which is exactly
 * what distinguishes them from the `migration_opening` plug figures.
 *
 * All or nothing, in one transaction - half an opening balance is worse than
 * none, because it looks finished.
 */
export async function importOpeningStock(
  scope: StoreScope, csvText: string, userId: string,
): Promise<{ lines: number; units: number; qty: number }> {
  const storeId = scopeForWrite(scope);
  const plan = await planOpeningImport(scope, csvText);
  if (plan.errors.length > 0) {
    throw new StockUnitError(`${plan.errors.length} row(s) need fixing first. Nothing was imported.`);
  }

  const serials = plan.lines.flatMap((l) => l.units.filter((s): s is string => !!s)
    .map((serial) => ({ productId: l.productId, serial })));
  const taken = await serialsAlreadyOnFile(storeId, serials);
  if (taken.length > 0) throw new StockUnitError(`Already on file: ${taken.slice(0, 5).join(', ')}. Nothing was imported.`);

  const now = new Date();
  const ref = `OPEN-${now.toISOString().slice(0, 10)}`;
  let unitCount = 0;

  await db.$transaction(async (tx) => {
    for (const l of plan.lines) {
      let lotId: string | null = null;
      if (l.trackingMode === 'batch' && l.lotNo) {
        const existing = await tx.stockLot.findFirst({
          where: { storeId, productId: l.productId, lotNo: l.lotNo }, select: { id: true },
        });
        lotId = existing?.id ?? (await tx.stockLot.create({
          data: {
            storeId, productId: l.productId, lotNo: l.lotNo, unitCostPaise: l.unitCostPaise,
            expiryDate: l.expiryDate, receivedAt: now, createdBy: userId,
          },
          select: { id: true },
        })).id;
      }

      await applyMovements(tx, storeId, userId, [{
        productId: l.productId, qty: l.qty, reason: 'opening',
        refType: 'OpeningStock', refNo: ref, lotId, note: 'Opening stock import',
      }]);

      if (l.units.length > 0) {
        const created = await tx.stockUnit.createManyAndReturn({
          data: l.units.map((serialNo) => ({
            storeId, productId: l.productId, serialNo, status: 'in_stock',
            condition: l.refurbished ? 'refurbished' : 'new',
            unitCostPaise: l.unitCostPaise, receivedAt: now, createdBy: userId,
          })),
          select: { id: true },
        });
        await tx.stockUnitEvent.createMany({
          data: created.map((u) => ({
            storeId, unitId: u.id, eventType: 'received', toStatus: 'in_stock',
            toCondition: l.refurbished ? 'refurbished' : 'new',
            refType: 'OpeningStock', refNo: ref, note: 'Opening stock', createdBy: userId,
          })),
        });
        unitCount += created.length;
      }
    }
  }, { timeout: 60_000 });

  return { lines: plan.lines.length, units: unitCount, qty: plan.lines.reduce((n, l) => n + l.qty, 0) };
}

/* -------------------------------------------------------------- field config */

export async function listStockFields(scope: StoreScope): Promise<StockFieldDef[]> {
  return db.stockFieldConfig.findMany({
    where: scopeWhere(scope),
    select: {
      fieldKey: true, label: true, fieldType: true, options: true, required: true,
      isActive: true, sortOrder: true, categoryId: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
}

/**
 * Add a field, or change one. The key is derived from the label ONCE, on
 * creation, and never again - it is what the values are stored under, so a
 * corrected spelling must not orphan every value recorded so far.
 */
export async function saveStockField(
  scope: StoreScope,
  input: {
    fieldKey?: string | null; label: string; fieldType: string; options: string | null;
    required: boolean; categoryId: string | null; sortOrder: number;
  },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const bad = validateFieldDef(input);
  if (bad) throw new StockUnitError(bad);

  if (input.categoryId) {
    const cat = await db.category.findFirst({ where: { id: input.categoryId, storeId }, select: { id: true } });
    if (!cat) throw new StockUnitError('That category is not in your scope.');
  }

  const data = {
    label: input.label.trim(), fieldType: input.fieldType,
    options: input.fieldType === 'select' ? input.options?.trim() || null : null,
    required: input.required, categoryId: input.categoryId, sortOrder: input.sortOrder,
  };

  if (input.fieldKey) {
    const { count } = await db.stockFieldConfig.updateMany({ where: { storeId, fieldKey: input.fieldKey }, data });
    if (count === 0) throw new StockUnitError('That field no longer exists.');
    return;
  }

  const fieldKey = fieldKeyFromLabel(input.label);
  const clash = await db.stockFieldConfig.findFirst({ where: { storeId, fieldKey }, select: { id: true } });
  if (clash) throw new StockUnitError(`A field called "${input.label.trim()}" already exists.`);
  await db.stockFieldConfig.create({ data: { storeId, fieldKey, ...data } });
}

/** Switch a field off or on. Never deleted: values recorded under it are kept. */
export async function setStockFieldActive(scope: StoreScope, fieldKey: string, isActive: boolean): Promise<void> {
  const storeId = scopeForWrite(scope);
  await db.stockFieldConfig.updateMany({ where: { storeId, fieldKey }, data: { isActive } });
}
