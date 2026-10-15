import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity } from './complaints';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements, type MovementInput } from './stock';
import { costsFor } from './product-cost';
import { complaintItems } from './complaint-items';
import { repairCostAccount } from '@/lib/service-revenue';
import { closeBlockers } from '@/lib/close-gate';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * HANDING ITEMS BACK (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 6).
 *
 * What came back from the supplier goes to the customer on a GDN on the SAME
 * complaint - the number Vcare's customers already sign for. Under the hood it
 * is a job challan of type `handback`, issued at once (there is nothing to
 * approve: most of it is the customer's own property), and its MaterialIssue
 * is the GDN, so it sits in the complaint GDN register and the paper trail
 * with every other GDN of the job.
 *
 * Three kinds of item, one document:
 * - their own unit, repaired or back unrepaired: no stock moves - it was
 *   never ours; the unit goes from "in for repair" to "with customer".
 * - the supplier's new serial: the same, and its full warranty starts today
 *   (decision 4).
 * - the supplier KEPT it (credit note / written reply): the customer gets a
 *   unit from our stock instead - stock goes out, its cost is booked to
 *   warranty cost when the warranty pays, else parts consumed, and its own
 *   warranty also starts today.
 */

const READY = ['back', 'supplier_closed'];

export interface HandBackOption {
  itemId: string; equipmentName: string; serialNo: string | null; status: string;
  productId: string | null; serial: boolean;
  /** What came back: the outcome, and the new serial when there is one. */
  outcome: string | null; newSerialNo: string | null;
  /** For an item the supplier kept: the units on our shelf that could go instead. */
  stockUnits: { id: string; serialNo: string }[];
  partsFree: boolean;
}

/** The items ready to hand back, with what could stand in for a kept one. */
export async function handBackOptions(scope: StoreScope, complaintId: string): Promise<HandBackOption[]> {
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, customerId: true, createdAt: true } });
  if (!job) return [];
  const views = await complaintItems(scope, job);
  const ready = views.filter((v) => READY.includes(v.status));
  if (!ready.length) return [];
  const rows = await db.complaintItem.findMany({
    where: { id: { in: ready.map((r) => r.id) } },
    select: { id: true, product: { select: { trackingMode: true } } },
  });
  const serial = new Map(rows.map((r) => [r.id, r.product?.trackingMode === 'serial']));
  const kept = ready.filter((r) => r.status === 'supplier_closed' && r.productId && serial.get(r.id));
  const shelf = kept.length
    ? await db.stockUnit.findMany({
      where: { ...scopeWhere(scope), productId: { in: [...new Set(kept.map((k) => k.productId!))] }, status: 'in_stock', deletedAt: null },
      orderBy: { receivedAt: 'asc' }, take: LIST_MAX_ROWS, select: { id: true, serialNo: true, productId: true },
    })
    : [];
  return ready.map((r) => ({
    itemId: r.id, equipmentName: r.equipmentName, serialNo: r.serialNo, status: r.status, productId: r.productId,
    serial: !!serial.get(r.id), outcome: r.rma?.outcome ?? null, newSerialNo: r.rma?.replacementSerialNo ?? null,
    stockUnits: r.status === 'supplier_closed' ? shelf.filter((u) => u.productId === r.productId).map((u) => ({ id: u.id, serialNo: u.serialNo ?? u.id })) : [],
    partsFree: r.cover.parts.free,
  }));
}

export interface HandBackInput {
  itemIds: string[];
  /** Kept-by-supplier items: the stock unit handed over instead (serial products). */
  fromStock: Record<string, string>;
  /** Who at the customer took them. */
  receivedBy: string | null;
  note: string | null;
}

export async function handBackItems(scope: StoreScope, complaintId: string, input: HandBackInput, userId: string): Promise<{ gdnNo: string; issueId: string; warnings: string[] }> {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({
    where: { id: complaintId, storeId },
    select: { id: true, complaintNo: true, customerId: true, productId: true, status: true, createdAt: true },
  });
  if (!job) throw new ComplaintError('That complaint is not in your scope.');
  if (['closed', 'cancelled'].includes(job.status)) throw new ComplaintError('This complaint is finished.');
  const ids = [...new Set(input.itemIds)];
  if (!ids.length) throw new ComplaintError('Tick the items being handed back.');

  const options = new Map((await handBackOptions(scope, complaintId)).map((o) => [o.itemId, o]));
  const items = await db.complaintItem.findMany({
    where: { id: { in: ids }, storeId, complaintId, deletedAt: null },
    select: {
      id: true, equipmentName: true, serialNo: true, status: true, productId: true, stockUnitId: true,
      replacementCases: {
        where: { deletedAt: null, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 1,
        select: { id: true, caseNo: true, status: true, outcome: true, replacementUnitId: true },
      },
    },
  });
  if (items.length !== ids.length) throw new ComplaintError('An item is not on this complaint.');

  // Everything checked before anything is written.
  const fromStock = new Map<string, { productId: string; unitId: string | null }>();
  for (const it of items) {
    const o = options.get(it.id);
    if (!o) throw new ComplaintError(`${it.equipmentName} is not ready to hand back - it has to come back from the supplier first.`);
    if (it.status !== 'supplier_closed') continue;
    if (!it.productId) throw new ComplaintError(`${it.equipmentName} is not a product of ours - there is nothing from stock to give in its place.`);
    if (o.serial) {
      const unitId = input.fromStock[it.id];
      if (!unitId) throw new ComplaintError(`Pick the serial from stock that goes to the customer in place of ${it.equipmentName}.`);
      if (!o.stockUnits.some((u) => u.id === unitId)) throw new ComplaintError(`The serial picked for ${it.equipmentName} is not in stock any more.`);
      fromStock.set(it.id, { productId: it.productId, unitId });
    } else {
      fromStock.set(it.id, { productId: it.productId, unitId: null });
    }
  }
  const unitIds = [...fromStock.values()].map((f) => f.unitId).filter((x): x is string => !!x);
  if (new Set(unitIds).size !== unitIds.length) throw new ComplaintError('The same serial is picked twice.');

  const costs = fromStock.size ? await costsFor(scope, [...new Set([...fromStock.values()].map((f) => f.productId))]) : new Map();
  const accountOf = (itemId: string) => repairCostAccount(options.get(itemId)!.partsFree ? 'warranty' : 'chargeable');
  const now = new Date();
  const [challanNo, gdnNo] = [await allocateDocumentNumber(storeId, 'JCH'), await allocateDocumentNumber(storeId, 'GDN')];
  const names = items.map((it) => `${it.equipmentName}${it.serialNo ? ` (S/N ${it.serialNo})` : ''}`);

  const issue = await db.$transaction(async (tx) => {
    const challan = await tx.jobChallan.create({
      data: {
        storeId, challanNo, complaintId, type: 'handback', status: 'issued', createdBy: userId, approvedBy: userId, approvedAt: now,
        note: [input.receivedBy?.trim() ? `Received by ${input.receivedBy.trim()}` : null, input.note?.trim() || null].filter(Boolean).join(' - ') || null,
        lines: {
          create: [...fromStock.entries()].map(([itemId, f]) => ({
            productId: f.productId, qty: 1, qtyIssued: 1, stockUnitIds: f.unitId ? [f.unitId] : [],
            unitCostPaise: costs.get(f.productId)?.unitCostPaise ?? 0, costAccount: accountOf(itemId),
          })),
        },
      },
      select: { id: true },
    });
    const mi = await tx.materialIssue.create({ data: { storeId, gdnNo, challanId: challan.id, issuedBy: userId, issuedAt: now }, select: { id: true } });
    const ref = { refType: 'MaterialIssue', refId: mi.id, refNo: gdnNo };

    // Our stock out, for the items the supplier kept.
    if (fromStock.size) {
      await applyMovements(tx, storeId, userId, [...fromStock.values()].map((f): MovementInput => (f.unitId
        ? { productId: f.productId, qty: -1, reason: 'job_issue', ...ref, stockUnitId: f.unitId }
        : { productId: f.productId, qty: -1, reason: 'job_issue', ...ref, partyId: job.customerId })));
    }
    // Every unit that goes to the customer: theirs again, or newly theirs.
    const toCustomer = async (unitId: string, from: string, fresh: boolean, note: string) => {
      await tx.stockUnit.update({ where: { id: unitId }, data: { status: 'with_customer', partyId: job.customerId, ...(fresh ? { warrantyFrom: now } : {}) } });
      await tx.stockUnitEvent.create({ data: { storeId, unitId, eventType: 'status', fromStatus: from, toStatus: 'with_customer', partyId: job.customerId, ...ref, note, createdBy: userId } });
    };
    for (const it of items) {
      const rma = it.replacementCases[0];
      const f = fromStock.get(it.id);
      if (f?.unitId) {
        await toCustomer(f.unitId, 'in_stock', true, `Given from stock on ${gdnNo} in place of ${it.serialNo ?? it.equipmentName}, which the supplier kept (${job.complaintNo}); warranty from today.`);
      } else if (rma?.outcome === 'replaced' && rma.replacementUnitId) {
        await toCustomer(rma.replacementUnitId, 'in_repair', true, `Supplier's new serial handed over on ${gdnNo} (${job.complaintNo}); warranty from today.`);
      } else if (it.stockUnitId && it.status === 'back') {
        const u = await tx.stockUnit.findUnique({ where: { id: it.stockUnitId }, select: { status: true } });
        if (u?.status === 'in_repair') await toCustomer(it.stockUnitId, 'in_repair', false, `Handed back on ${gdnNo} (${job.complaintNo}).`);
      }
      await tx.complaintItem.update({ where: { id: it.id }, data: { status: 'handed_back', handbackIssueId: mi.id } });
    }
    // Kind `pickup` - the repair loop's own entry, whose words reach the customer; a
    // `status_change` body is the office's reason and is hidden from them.
    await logActivity(tx, complaintId, 'pickup', userId, {
      body: `Handed back on ${gdnNo}: ${names.join(', ')}.${input.receivedBy?.trim() ? ` Received by ${input.receivedBy.trim()}.` : ''}`,
      visibleToPortal: true,
    });
    return mi;
  });

  const warnings: string[] = [];
  // The supplier cases close the loop: returned to the customer.
  const { moveRmaCase } = await import('./rma');
  for (const it of items) {
    const rma = it.replacementCases[0];
    if (rma?.status !== 'received_back') continue;
    try {
      const r = await moveRmaCase(scope, rma.id, { to: 'returned_to_customer', note: `Handed back on ${gdnNo}.` }, userId);
      if (r.warning) warnings.push(`${rma.caseNo}: ${r.warning}`);
    } catch (e) {
      warnings.push(`${rma.caseNo}: ${(e as Error).message}`);
    }
  }
  // The cost of what we gave from stock, by who pays for it.
  if (fromStock.size) {
    const { postPartsCost } = await import('./job-challans');
    const byAccount = new Map<string, { productId: string; qty: number; unitCostPaise: number }[]>();
    for (const [itemId, f] of fromStock) {
      const a = accountOf(itemId);
      byAccount.set(a, [...(byAccount.get(a) ?? []), { productId: f.productId, qty: 1, unitCostPaise: costs.get(f.productId)?.unitCostPaise ?? 0 }]);
    }
    for (const [account, lines] of byAccount) {
      await postPartsCost(scope, job, lines, { sourceType: 'job_material_issue', sourceId: issue.id, description: `Given from stock on ${gdnNo} in place of items the supplier kept`, sign: 1, account }, userId)
        .catch((e: Error) => warnings.push(`The stock cost was not posted to accounts: ${e.message}`));
    }
  }
  return { gdnNo, issueId: issue.id, warnings };
}

/** Why this complaint cannot be closed yet - empty when it can. */
export async function complaintCloseBlockers(complaintId: string, opts: { ignoreVisits?: boolean } = {}): Promise<string[]> {
  const [items, visits] = await Promise.all([
    db.complaintItem.findMany({ where: { complaintId, deletedAt: null }, select: { equipmentName: true, serialNo: true, status: true } }),
    opts.ignoreVisits ? Promise.resolve([]) : db.serviceVisit.findMany({ where: { complaintId }, select: { status: true, scheduledAt: true } }),
  ]);
  return closeBlockers(items, visits);
}

/** The same, as a refusal. */
export async function assertCanClose(complaintId: string, opts: { ignoreVisits?: boolean } = {}): Promise<void> {
  const why = await complaintCloseBlockers(complaintId, opts);
  if (why.length) throw new ComplaintError(`Not yet - ${why.join(' ')}`);
}

/**
 * Closing (not resolving) also needs the money settled (stage 7, spec step 9):
 * anything chargeable is billed, or the office said why not (Don't bill).
 */
export async function assertBilledToClose(scope: StoreScope, complaintId: string): Promise<void> {
  const { unbilledPaise } = await import('./job-billing');
  const due = await unbilledPaise(scope, complaintId);
  if (due > 0) throw new ComplaintError(`Not yet - ₹${(due / 100).toLocaleString('en-IN')} + GST is chargeable on this job and not billed. Use Bill this job, or Don't bill with a reason.`);
}
