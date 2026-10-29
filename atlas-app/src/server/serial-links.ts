import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { UNIT_STATUS_LABEL, type UnitStatus } from '@/lib/stock-units';
import { docHref } from '@/lib/doc-href';

/**
 * A serial named, changed or confirmed AFTER the document moved the stock
 * (29 Oct 2026, Vcare).
 *
 * Every screen reads a unit's whereabouts from four places - the unit itself
 * (status, holder, bill), its events, the stock movement that moved it, and the
 * document line that names it. This file is the one place that changes them
 * together, in the caller's transaction, so a serial added on a GDN is the same
 * answer on the complaint, the GDN, the bill, Product History and the customer.
 *
 * Quantity never moves here: the document moved it when it was made. Only
 * "which unit" is being settled.
 */

type Tx = Prisma.TransactionClient;
export type Ref = { refType: string; refId: string; refNo: string };
export class SerialLinkError extends Error {}

/** The note `bindUnitsForOutflow` leaves when Atlas picked the unit, not a person. */
export const GUESSED_NOTE = 'Allocated automatically, oldest stock first.';
/** Documents that put a unit somewhere without anybody claiming it is theirs. */
const UNCLAIMED_REFS = [null, 'StockUnit', 'OpeningStock', 'StockCount', 'Manual', 'StockIn', 'GoodsReceiptNote'];
// Only what is free on the shelf: a reserved unit is promised to a challan.
const SHELF: UnitStatus[] = ['in_stock'];

export interface LinkedUnit { id: string; serialNo: string; status: string; guessed: boolean }

const label = (s: string) => UNIT_STATUS_LABEL[s as UnitStatus]?.toLowerCase() ?? s;
type Who = { companyName: string | null; firstName: string; lastName: string | null } | null;
const who = (p: Who) => (p ? p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') : null);

/**
 * The units a document moved that are still where it put them - their latest
 * status change is this document's, so a unit that later came back or went on
 * elsewhere no longer counts against it.
 */
export async function unitsOnRef(
  c: Tx | typeof db, storeIds: string[], ref: { refType: string; refId: string }, statuses: string[],
): Promise<Map<string, LinkedUnit[]>> {
  const evs = await c.stockUnitEvent.findMany({
    where: { storeId: { in: storeIds }, refType: ref.refType, refId: ref.refId, eventType: { in: ['status', 'confirmed'] } },
    select: { unitId: true, eventType: true, note: true },
  });
  const ids = [...new Set(evs.map((e) => e.unitId))];
  if (!ids.length) return new Map();
  const units = await c.stockUnit.findMany({
    where: { id: { in: ids }, storeId: { in: storeIds }, deletedAt: null, status: { in: statuses } },
    select: {
      id: true, serialNo: true, productId: true, status: true,
      events: { where: { eventType: 'status' }, orderBy: { createdAt: 'desc' }, take: 1, select: { refType: true, refId: true } },
    },
  });
  const out = new Map<string, LinkedUnit[]>();
  for (const u of units) {
    const last = u.events[0];
    if (!last || last.refType !== ref.refType || last.refId !== ref.refId) continue;
    const mine = evs.filter((e) => e.unitId === u.id);
    const guessed = mine.some((e) => e.eventType === 'status' && e.note === GUESSED_NOTE) && !mine.some((e) => e.eventType === 'confirmed');
    out.set(u.productId, [...(out.get(u.productId) ?? []), { id: u.id, serialNo: u.serialNo ?? u.id, status: u.status, guessed }]);
  }
  return out;
}

/** Is this unit free to be claimed by a document - on the shelf, or with `partyId` and claimed by no document? */
async function freeFor(c: Tx | typeof db, unit: { id: string; status: string; partyId: string | null }, to: string, partyId: string | null) {
  if (SHELF.includes(unit.status as UnitStatus)) return true;
  if (unit.status !== to || unit.partyId !== partyId) return false;
  const last = await c.stockUnitEvent.findFirst({ where: { unitId: unit.id, eventType: 'status' }, orderBy: { createdAt: 'desc' }, select: { refType: true } });
  return UNCLAIMED_REFS.includes(last?.refType ?? null);
}

/**
 * Send one unit out on a document: it goes to `partyId` (customer or supplier),
 * carries the bill, gets the document's event, and the document's unnamed
 * outflow row learns its serial.
 */
export async function sendUnit(tx: Tx, storeId: string, userId: string, a: {
  unitId: string; productId: string; to: 'with_customer' | 'with_supplier'; partyId: string | null;
  invoiceId: string | null; ref: Ref; note: string;
}): Promise<string> {
  const u = await tx.stockUnit.findFirst({
    where: { id: a.unitId, storeId, productId: a.productId, deletedAt: null },
    select: { id: true, serialNo: true, status: true, partyId: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
  });
  if (!u) throw new SerialLinkError('That serial is not one of this product in this store.');
  const serial = u.serialNo ?? u.id;
  if (!(await freeFor(tx, u, a.to, a.partyId))) {
    throw new SerialLinkError(`${serial} is ${label(u.status)}${who(u.party) ? ` (${who(u.party)})` : ''} on another document - bring it back or change it there first.`);
  }
  await tx.stockUnit.update({
    where: { id: u.id },
    data: { status: a.to, partyId: a.partyId, ...(a.to === 'with_customer' && a.invoiceId ? { invoiceId: a.invoiceId } : {}) },
  });
  await tx.stockUnitEvent.create({
    data: { storeId, unitId: u.id, eventType: 'status', fromStatus: u.status, toStatus: a.to, partyId: a.partyId, ...a.ref, note: a.note, createdBy: userId },
  });
  // shortcut: only a one-unit outflow row can carry one serial; a row of 3 keeps
  // its count and the unit's own history names the document. Split rows if the
  // product timeline ever needs every serial.
  const row = await tx.stockMovement.findFirst({
    where: { storeId, productId: a.productId, refType: a.ref.refType, refId: a.ref.refId, qty: -1, stockUnitId: null },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (row) await tx.stockMovement.update({ where: { id: row.id }, data: { stockUnitId: u.id } });
  return serial;
}

/**
 * Bring one unit back to the shelf because a document named the wrong one (or
 * a return names it). Its bill goes with it when the bill was `invoiceId`.
 */
export async function shelveUnit(tx: Tx, storeId: string, userId: string, a: {
  unitId: string; ref: Ref; note: string; invoiceId: string | null; from: string[];
}): Promise<string> {
  const u = await tx.stockUnit.findFirst({ where: { id: a.unitId, storeId, deletedAt: null }, select: { id: true, serialNo: true, status: true, invoiceId: true } });
  if (!u || !a.from.includes(u.status)) throw new SerialLinkError('That serial is not where this document put it any more - it was moved since.');
  await tx.stockUnit.update({
    where: { id: u.id },
    data: { status: 'in_stock', partyId: null, ...(a.invoiceId && u.invoiceId === a.invoiceId ? { invoiceId: null } : {}) },
  });
  await tx.stockUnitEvent.create({ data: { storeId, unitId: u.id, eventType: 'status', fromStatus: u.status, toStatus: 'in_stock', ...a.ref, note: a.note, createdBy: userId } });
  await tx.stockMovement.updateMany({ where: { storeId, refType: a.ref.refType, refId: a.ref.refId, stockUnitId: u.id }, data: { stockUnitId: null } });
  return u.serialNo ?? u.id;
}

/* ------------------------------------------------------------- documents */

export type SerialDocKind = 'invoice' | 'order' | 'purchase_return' | 'sales_return';

interface SerialDoc {
  ref: Ref; storeId: string; partyId: string | null; invoiceId: string | null;
  /** out: the document sent units away. in: it brought them back to the shelf. */
  direction: 'out' | 'in';
  to: 'with_customer' | 'with_supplier';
  /** Stock moved and the document is not cancelled. */
  live: boolean;
  lines: { productId: string; productName: string; qty: number }[];
}

function sum(lines: { productId: string | null; productName: string; qty: number }[]) {
  const m = new Map<string, { productId: string; productName: string; qty: number }>();
  for (const l of lines) {
    if (!l.productId || l.qty <= 0) continue;
    const had = m.get(l.productId);
    m.set(l.productId, { productId: l.productId, productName: had?.productName ?? l.productName, qty: (had?.qty ?? 0) + l.qty });
  }
  return [...m.values()];
}

async function loadDoc(scope: StoreScope, kind: SerialDocKind, id: string): Promise<SerialDoc> {
  const where = { id, ...scopeWhere(scope) };
  if (kind === 'invoice') {
    const inv = await db.invoice.findFirst({ where, select: { id: true, invoiceNo: true, storeId: true, partyId: true, salesOrderId: true, lifecycle: true, items: { select: { productId: true, productName: true, qty: true } } } });
    if (!inv) throw new SerialLinkError('Invoice not found in your scope.');
    // An invoice made from an order: the goods left on the order's dispatch.
    if (inv.salesOrderId) return { ...(await loadDoc(scope, 'order', inv.salesOrderId)), invoiceId: inv.id };
    return {
      ref: { refType: 'invoice', refId: inv.id, refNo: inv.invoiceNo }, storeId: inv.storeId, partyId: inv.partyId, invoiceId: inv.id,
      direction: 'out', to: 'with_customer', live: inv.lifecycle !== 'cancelled', lines: sum(inv.items),
    };
  }
  if (kind === 'order') {
    const o = await db.salesOrder.findFirst({ where, select: { id: true, orderNo: true, storeId: true, partyId: true, fulfilmentStatus: true, items: { select: { productId: true, productName: true, dispatchedQty: true, returnedQty: true } } } });
    if (!o) throw new SerialLinkError('Order not found in your scope.');
    const inv = await db.invoice.findFirst({ where: { salesOrderId: o.id, ...scopeWhere(scope), lifecycle: { not: 'cancelled' } }, select: { id: true } });
    return {
      ref: { refType: 'SalesOrder', refId: o.id, refNo: o.orderNo }, storeId: o.storeId, partyId: o.partyId, invoiceId: inv?.id ?? null,
      direction: 'out', to: 'with_customer', live: o.fulfilmentStatus !== 'void',
      lines: sum(o.items.map((i) => ({ productId: i.productId, productName: i.productName, qty: (i.dispatchedQty ?? 0) - (i.returnedQty ?? 0) }))),
    };
  }
  if (kind === 'purchase_return') {
    const pr = await db.purchaseReturn.findFirst({ where, select: { id: true, returnNo: true, storeId: true, partyId: true, lifecycle: true, items: { select: { productId: true, productName: true, qty: true } } } });
    if (!pr) throw new SerialLinkError('Purchase return not found in your scope.');
    return {
      ref: { refType: 'PurchaseReturn', refId: pr.id, refNo: pr.returnNo }, storeId: pr.storeId, partyId: pr.partyId, invoiceId: null,
      direction: 'out', to: 'with_supplier', live: pr.lifecycle === 'dispatched', lines: sum(pr.items),
    };
  }
  const sr = await db.salesReturn.findFirst({ where, select: { id: true, returnNo: true, storeId: true, partyId: true, invoiceId: true, lifecycle: true, items: { select: { productId: true, productName: true, qty: true, disposition: true } } } });
  if (!sr) throw new SerialLinkError('Sales return not found in your scope.');
  return {
    ref: { refType: 'SalesReturn', refId: sr.id, refNo: sr.returnNo }, storeId: sr.storeId, partyId: sr.partyId, invoiceId: sr.invoiceId,
    direction: 'in', to: 'with_customer', live: sr.lifecycle === 'received',
    // Only what went back on the shelf has a unit to name.
    lines: sum(sr.items.filter((i) => i.disposition === 'restock')),
  };
}

export interface DocSerialLine { productId: string; productName: string; qty: number; units: LinkedUnit[]; unnamed: number }

/** The serial lines of a document: products kept by serial, or with a unit already on it. */
export async function docSerials(scope: StoreScope, kind: SerialDocKind, id: string): Promise<{ live: boolean; direction: 'out' | 'in'; lines: DocSerialLine[] }> {
  return serialsOf(db, await loadDoc(scope, kind, id));
}

async function serialsOf(c: Tx | typeof db, d: SerialDoc): Promise<{ live: boolean; direction: 'out' | 'in'; lines: DocSerialLine[] }> {
  const on = await unitsOnRef(c, [d.storeId], d.ref, d.direction === 'out' ? [d.to] : ['in_stock', 'reserved']);
  const serial = new Set((await c.product.findMany({ where: { id: { in: d.lines.map((l) => l.productId) }, trackingMode: 'serial' }, select: { id: true } })).map((p) => p.id));
  const lines = d.live ? d.lines.filter((l) => serial.has(l.productId) || on.has(l.productId)).map((l) => {
    const units = on.get(l.productId) ?? [];
    return { ...l, units, unnamed: Math.max(0, l.qty - units.length) };
  }) : [];
  return { live: d.live, direction: d.direction, lines };
}

/** Serials that could be named on this document for one product. */
export async function docSerialCandidates(scope: StoreScope, kind: SerialDocKind, id: string, productId: string, q: string): Promise<{ id: string; serialNo: string; where: string }[]> {
  const d = await loadDoc(scope, kind, id);
  const text = q.trim();
  const units = await db.stockUnit.findMany({
    where: {
      storeId: d.storeId, productId, deletedAt: null, serialNo: text ? { contains: text, mode: 'insensitive' } : { not: null },
      // Going out: off the shelf, or already this party's. Coming back: only this party's.
      ...(d.direction === 'out'
        ? { OR: [{ status: { in: SHELF } }, { status: d.to, partyId: d.partyId }] }
        : { status: 'with_customer', OR: [{ partyId: d.partyId }, ...(d.invoiceId ? [{ invoiceId: d.invoiceId }] : [])] }),
    },
    orderBy: { serialNo: 'asc' }, take: 50,
    select: { id: true, serialNo: true, status: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
  });
  return units.map((u) => ({ id: u.id, serialNo: u.serialNo ?? u.id, where: who(u.party) ? `${label(u.status)} · ${who(u.party)}` : label(u.status) }));
}

function need(reason: string) {
  const why = reason.trim();
  if (!why) throw new SerialLinkError('Say why - it is kept in the serial\'s history.');
  return why;
}

/** Name a serial the document moved without one. */
export async function addDocSerial(scope: StoreScope, kind: SerialDocKind, id: string, productId: string, unitId: string, reason: string, userId: string): Promise<string> {
  scopeForWrite(scope);
  const why = need(reason);
  const d = await loadDoc(scope, kind, id);
  return db.$transaction(async (tx) => {
    // One serial change per document at a time, the count read inside it - two
    // clicks at once cannot name more serials than the quantity.
    await lockDoc(tx, d);
    const line = (await serialsOf(tx, d)).lines.find((l) => l.productId === productId);
    if (!line) throw new SerialLinkError('That product is not on this document.');
    if (line.unnamed <= 0) throw new SerialLinkError(`Every ${line.productName} on ${d.ref.refNo} already has its serial - change one instead.`);
    return d.direction === 'out'
      ? sendUnit(tx, d.storeId, userId, { unitId, productId, to: d.to, partyId: d.partyId, invoiceId: d.invoiceId, ref: d.ref, note: `Serial named after ${d.ref.refNo}: ${why}` })
      : backFromCustomer(tx, d, unitId, productId, userId, `Came back on ${d.ref.refNo}: ${why}`);
  });
}

/** The document named the wrong unit: swap it for the right one. */
export async function changeDocSerial(scope: StoreScope, kind: SerialDocKind, id: string, fromUnitId: string, toUnitId: string, reason: string, userId: string): Promise<{ from: string; to: string }> {
  scopeForWrite(scope);
  const why = need(reason);
  if (fromUnitId === toUnitId) throw new SerialLinkError('Pick a different serial number.');
  const d = await loadDoc(scope, kind, id);
  return db.$transaction(async (tx) => {
    await lockDoc(tx, d);
    const line = (await serialsOf(tx, d)).lines.find((l) => l.units.some((u) => u.id === fromUnitId));
    if (!line) throw new SerialLinkError('That serial is not on this document.');
    if (d.direction === 'out') {
      const from = await shelveUnit(tx, d.storeId, userId, { unitId: fromUnitId, ref: d.ref, invoiceId: d.invoiceId, from: [d.to], note: `Not the one on ${d.ref.refNo}: ${why}` });
      const to = await sendUnit(tx, d.storeId, userId, { unitId: toUnitId, productId: line.productId, to: d.to, partyId: d.partyId, invoiceId: d.invoiceId, ref: d.ref, note: `In place of ${from} on ${d.ref.refNo}: ${why}` });
      return { from, to };
    }
    // A return: the unit we shelved is still the customer's; the one named came back.
    await tx.stockMovement.updateMany({ where: { storeId: d.storeId, refType: d.ref.refType, refId: d.ref.refId, stockUnitId: fromUnitId }, data: { stockUnitId: null } });
    const to = await backFromCustomer(tx, d, toUnitId, line.productId, userId, `Came back on ${d.ref.refNo} in place of another: ${why}`);
    const from = await sendUnit(tx, d.storeId, userId, { unitId: fromUnitId, productId: line.productId, to: 'with_customer', partyId: d.partyId, invoiceId: d.invoiceId, ref: d.ref, note: `Did not come back on ${d.ref.refNo} - ${to} did: ${why}` });
    return { from, to };
  });
}

/** Somebody checked an automatically picked serial and it is right. */
export async function confirmDocSerial(scope: StoreScope, kind: SerialDocKind, id: string, unitId: string, userId: string): Promise<void> {
  scopeForWrite(scope);
  const d = await loadDoc(scope, kind, id);
  const ok = (await serialsOf(db, d)).lines.some((l) => l.units.some((u) => u.id === unitId && u.guessed));
  if (!ok) throw new SerialLinkError('That serial is not waiting to be checked on this document.');
  await db.stockUnitEvent.create({ data: { storeId: d.storeId, unitId, eventType: 'confirmed', ...d.ref, note: `Checked: this is the unit on ${d.ref.refNo}.`, createdBy: userId } });
}

/** Serializes serial changes on one document; released with the transaction. */
async function lockDoc(tx: Tx, d: SerialDoc) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`serials:${d.ref.refType}:${d.ref.refId}`}))`;
}

async function backFromCustomer(tx: Tx, d: SerialDoc, unitId: string, productId: string, userId: string, note: string): Promise<string> {
  const u = await tx.stockUnit.findFirst({ where: { id: unitId, storeId: d.storeId, productId, deletedAt: null }, select: { status: true, partyId: true, invoiceId: true } });
  if (!u || u.status !== 'with_customer' || (u.partyId !== d.partyId && (!d.invoiceId || u.invoiceId !== d.invoiceId))) {
    throw new SerialLinkError('Only a serial this customer has can come back on their return.');
  }
  const serial = await shelveUnit(tx, d.storeId, userId, { unitId, ref: d.ref, invoiceId: null, from: ['with_customer'], note });
  const row = await tx.stockMovement.findFirst({ where: { storeId: d.storeId, productId, refType: d.ref.refType, refId: d.ref.refId, qty: 1, stockUnitId: null }, select: { id: true } });
  if (row) await tx.stockMovement.update({ where: { id: row.id }, data: { stockUnitId: unitId } });
  return serial;
}

/**
 * A serial scanned on an installation after its order already sent the stock
 * (29 Oct 2026): the scanned unit becomes the one the order sent, in place of
 * the item's previous serial or one Atlas picked. Before dispatch nothing is
 * done - dispatch takes the scanned serials.
 */
export async function settleOrderUnit(
  scope: StoreScope, orderId: string, productId: string, unitId: string, replacedUnitId: string | null, reason: string, userId: string,
): Promise<void> {
  const line = (await docSerials(scope, 'order', orderId)).lines.find((l) => l.productId === productId);
  if (!line || line.units.some((u) => u.id === unitId)) return;
  const scanned = new Set((await db.installationChallanItem.findMany({
    where: { challan: { salesOrderId: orderId, ...scopeWhere(scope) }, stockUnitId: { not: null } }, select: { stockUnitId: true },
  })).map((i) => i.stockUnitId));
  scanned.add(unitId);
  // Never over a serial somebody checked: only the item's own previous serial, or one Atlas picked.
  const swap = line.units.find((u) => u.id === replacedUnitId) ?? line.units.find((u) => u.guessed && !scanned.has(u.id));
  if (swap) await changeDocSerial(scope, 'order', orderId, swap.id, unitId, reason, userId);
  else if (line.unnamed > 0) await addDocSerial(scope, 'order', orderId, productId, unitId, reason, userId);
  else throw new SerialLinkError(`Every ${line.productName} on this order already has a checked serial - change it on the order first.`);
}

/* ------------------------------------------------------- the cross-check */

const CHECK_MAX = 2000;
const GUESS_MAX = 1000;

export interface SerialCheckRow { key: string; serialNo: string | null; unitId: string | null; productName: string; problem: string; docNo: string | null; href: string | null }

/**
 * Where the four records of a serial disagree, or a serial is still unknown
 * (29 Oct 2026). Every row opens the document it is about. Read-only.
 *
 *   not named   a job line sent more serial parts than it names
 *   astray      a unit a job line names is not with that job's customer, or
 *               the job is billed and the unit does not carry the bill
 *   picked      a unit Atlas chose by itself that nobody has checked
 */
export async function serialChecks(scope: StoreScope): Promise<{ notNamed: SerialCheckRow[]; picked: SerialCheckRow[]; astray: SerialCheckRow[]; pickedTotal: number; capped: boolean }> {
  const lines = await db.jobChallanLine.findMany({
    orderBy: { updatedAt: 'desc' },
    where: { challan: { ...scopeWhere(scope), status: 'issued' }, product: { trackingMode: 'serial' }, qtyIssued: { gt: 0 } },
    take: CHECK_MAX,
    select: {
      id: true, qtyIssued: true, qtyReturned: true, stockUnitIds: true, product: { select: { productName: true } },
      challan: {
        select: {
          challanNo: true, complaintId: true, installationChallanId: true,
          complaint: { select: { customerId: true, invoiceId: true } },
          installationChallan: { select: { salesOrder: { select: { partyId: true } } } },
          issues: { where: { cancelledAt: null }, select: { gdnNo: true }, take: 1 },
        },
      },
    },
  });
  type Job = (typeof lines)[number]['challan'];
  const jobHref = (c: Job) => (c.complaintId ? `/services/complaints/${c.complaintId}` : c.installationChallanId ? `/services/installations/${c.installationChallanId}` : null);
  const docNo = (c: Job) => c.issues[0]?.gdnNo ?? c.challanNo;

  const notNamed: SerialCheckRow[] = [];
  for (const l of lines) {
    const n = l.qtyIssued - l.qtyReturned - l.stockUnitIds.length;
    if (n > 0) notNamed.push({ key: `n-${l.id}`, serialNo: null, unitId: null, productName: l.product.productName, problem: `${n} sent with no serial`, docNo: docNo(l.challan), href: jobHref(l.challan) });
  }

  const named = lines.flatMap((l) => l.stockUnitIds.map((id) => ({ id, l })));
  const units = new Map((named.length ? await db.stockUnit.findMany({
    where: { id: { in: named.map((x) => x.id) }, ...scopeWhere(scope) }, select: { id: true, serialNo: true, status: true, partyId: true, invoiceId: true },
  }) : []).map((u) => [u.id, u]));
  const astray: SerialCheckRow[] = [];
  for (const { id, l } of named) {
    const u = units.get(id);
    const party = l.challan.complaint?.customerId ?? l.challan.installationChallan?.salesOrder?.partyId ?? null;
    const bill = l.challan.complaint?.invoiceId ?? null;
    const problem = !u ? 'serial record missing'
      : u.status !== 'with_customer' ? `on the job but ${label(u.status)}`
        : party && u.partyId !== party ? 'on the job but with another customer'
          : bill && u.invoiceId !== bill ? 'job billed but the serial is not on the bill' : null;
    if (problem) astray.push({ key: `a-${l.id}-${id}`, serialNo: u?.serialNo ?? null, unitId: u ? id : null, productName: l.product.productName, problem, docNo: docNo(l.challan), href: jobHref(l.challan) });
  }

  // Out with somebody, last moved by Atlas's own pick, never checked.
  const guesses = await db.stockUnitEvent.findMany({
    where: { ...scopeWhere(scope), eventType: 'status', note: GUESSED_NOTE, unit: { status: { in: ['with_customer', 'with_supplier'] }, deletedAt: null } },
    orderBy: { createdAt: 'desc' }, take: GUESS_MAX,
    select: { unitId: true, refType: true, refId: true, refNo: true, unit: { select: { serialNo: true, product: { select: { productName: true } } } } },
  });
  const ids = [...new Set(guesses.map((g) => g.unitId))];
  const [lastMoves, checked] = ids.length ? await Promise.all([
    db.stockUnitEvent.findMany({ where: { unitId: { in: ids }, eventType: 'status' }, orderBy: { createdAt: 'desc' }, distinct: ['unitId'], select: { unitId: true, refId: true } }),
    db.stockUnitEvent.findMany({ where: { unitId: { in: ids }, eventType: 'confirmed' }, select: { unitId: true, refId: true } }),
  ]) : [[], []];
  const last = new Map(lastMoves.map((e) => [e.unitId, e.refId]));
  const ok = new Set(checked.map((e) => `${e.unitId}:${e.refId}`));
  const seen = new Set<string>();
  const pickedAll = guesses.filter((g) => {
    if (seen.has(g.unitId) || last.get(g.unitId) !== g.refId || ok.has(`${g.unitId}:${g.refId}`)) return false;
    seen.add(g.unitId);
    return true;
  });
  const picked = pickedAll.slice(0, 200).map((g) => ({
    key: `p-${g.unitId}`, serialNo: g.unit.serialNo, unitId: g.unitId, productName: g.unit.product.productName,
    problem: 'picked by Atlas, not checked', docNo: g.refNo, href: docHref(g.refType, g.refId, g.refNo),
  }));
  return { notNamed, picked, astray, pickedTotal: pickedAll.length, capped: lines.length === CHECK_MAX || guesses.length === GUESS_MAX };
}
