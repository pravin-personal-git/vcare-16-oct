import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity } from './complaints';
import { getJobSettings } from './job-settings';
import { jobEvent } from './job-notify';
import { estimateTotal, type EstimateLine } from './job-customer';
import { jobBillLines, billTotals, type BillLine } from '@/lib/job-bill';
import { repairCostAccount } from '@/lib/service-revenue';

/**
 * Office-side billing of field jobs (live test 2, 28 Sep 2026): what was
 * really used, the estimate following returns, and Bill this job. Kept out of
 * job-customer.ts, which must never read challans or costs (customer-facing).
 */

/** Parts actually used on a job, by product: issued minus returned, on GDNs. */
export async function usedParts(complaintId: string): Promise<Map<string, number>> {
  const lines = await db.jobChallanLine.findMany({
    // A hand-back GDN (stage 6) is not parts used on the job - it is billed per item below.
    where: { challan: { complaintId, status: 'issued', type: { not: 'handback' } } },
    select: { productId: true, qtyIssued: true, qtyReturned: true },
  });
  const used = new Map<string, number>();
  for (const l of lines) used.set(l.productId, (used.get(l.productId) ?? 0) + Math.max(0, l.qtyIssued - l.qtyReturned));
  return used;
}

/**
 * A waiting estimate follows the parts really used: after a return or a GDN
 * correction a part line drops to what was used (live test 2 - the customer
 * was asked to approve 4 when 3 were used). The customer is told again.
 */
export async function syncEstimateToUsed(complaintId: string, userId: string | null): Promise<void> {
  const est = await db.jobEstimate.findFirst({ where: { complaintId, status: 'waiting' }, orderBy: { createdAt: 'desc' } });
  if (!est) return;
  const used = await usedParts(complaintId);
  let changed = false;
  const next = (est.lines as unknown as EstimateLine[]).flatMap((l) => {
    if (!l.productId || !used.has(l.productId)) return [l];
    const u = used.get(l.productId)!;
    if (l.qty <= u) return [l];
    changed = true;
    return u > 0 ? [{ ...l, qty: u }] : [];
  });
  if (!changed) return;
  const total = estimateTotal(next);
  await db.jobEstimate.update({ where: { id: est.id }, data: { lines: next as unknown as object[], totalPaise: total } });
  await logActivity(db, complaintId, 'estimate', userId, {
    body: `Estimate updated to the parts actually used: ₹${(total / 100).toLocaleString('en-IN')} (incl. GST).`, visibleToPortal: true,
  });
  await jobEvent(complaintId, 'estimate_sent', `₹${(total / 100).toLocaleString('en-IN')} (updated)`);
}

/** The office sends a price for chargeable work; the job waits for the customer (spec §4.5). */

/**
 * WHAT THIS JOB WOULD BILL (10 Oct 2026, repair flow stage 7) - the same lines
 * for the preview on the complaint, the close gate and Bill this job.
 *
 * An approved estimate is what the customer agreed to, so it wins (parts at
 * the quantity actually used). Otherwise the two switches decide, item by item
 * - `lib/job-bill`, where the rule and the spec's acceptance tests live.
 */
export interface JobBillDraft {
  lines: BillLine[];
  fromEstimate: boolean;
  /** The lines are the office's own (Change the bill), not the customer's approved estimate. */
  fromOffice: boolean;
  /** Before GST / with GST. */
  basePaise: number;
  withGstPaise: number;
}

export async function jobBillDraft(
  scope: StoreScope, complaintId: string,
  /** The complaint page already has its items - passed in so they are not read twice. */
  known?: { items?: import('./complaint-items').ComplaintItemView[] },
): Promise<JobBillDraft | null> {
  const job = await db.complaint.findFirst({
    where: { id: complaintId, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, customerId: true, productId: true, createdAt: true,
      estimates: { where: { status: 'approved' }, orderBy: { createdAt: 'desc' }, take: 1, select: { lines: true, decidedVia: true } },
      visits: { where: { status: { not: 'cancelled' } }, select: { id: true } },
    },
  });
  if (!job) return null;
  const fromOffice = job.estimates[0]?.decidedVia === 'office';
  const used = await usedParts(job.id);
  // Units handed over from our stock in place of ones the supplier kept, when
  // the customer pays for them (their cost went to parts consumed, stage 6).
  const stockLines = await db.jobChallanLine.findMany({
    where: { challan: { complaintId: job.id, status: 'issued', type: 'handback' }, costAccount: repairCostAccount('chargeable') },
    select: { productId: true, qtyIssued: true },
  });
  const ids = [...new Set([...used.keys(), ...stockLines.map((l) => l.productId)])];
  const products = new Map((ids.length ? await db.product.findMany({
    where: { id: { in: ids }, storeId: job.storeId },
    select: { id: true, productName: true, productCode: true, hsnCode: true, prices: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true, taxRatePct: true } } },
  }) : []).map((p) => [p.id, p]));
  const asLine = (productId: string, qty: number): BillLine | null => {
    const p = products.get(productId);
    if (!p || qty <= 0) return null;
    return { description: p.productName, productCode: p.productCode, hsnCode: p.hsnCode, qty, unitPaise: p.prices[0]?.dlpPaise ?? 0, taxRatePct: p.prices[0] ? Number(p.prices[0].taxRatePct) : 18, productId };
  };

  let lines: BillLine[];
  const est = job.estimates[0]?.lines as unknown as EstimateLine[] | undefined;
  if (est) {
    lines = est.flatMap((l): BillLine[] => {
      const qty = l.productId && used.has(l.productId) ? Math.min(l.qty, used.get(l.productId)!) : l.qty;
      if (qty <= 0) return [];
      const p = l.productId ? products.get(l.productId) : undefined;
      return [{ description: l.description, productCode: p?.productCode ?? null, hsnCode: p?.hsnCode ?? null, qty, unitPaise: l.unitPaise, taxRatePct: l.taxRatePct ?? 18, productId: l.productId ?? null }];
    });
  } else {
    const { resolveSplitCoverFor } = await import('./amc');
    const { complaintItems, jobCoverFromItems } = await import('./complaint-items');
    const items = known?.items ?? await complaintItems(scope, { id: job.id, customerId: job.customerId, createdAt: job.createdAt });
    // Items decide when the job has them (stage 2); an old complaint reads its one product.
    const byItems = jobCoverFromItems(items);
    const split = byItems ? null : await resolveSplitCoverFor(scope, { customerId: job.customerId, productId: job.productId, onDate: job.createdAt });
    const labourFree = byItems ? byItems.labourFree : split!.labour.free;
    const partsFree = byItems ? byItems.partsFree : split!.parts.free;
    const settings = await getJobSettings(job.storeId);
    lines = jobBillLines({
      labourFree,
      // Per visit (decision 3): pickup and refit are two visits, two charges.
      visits: Math.max(1, job.visits.length),
      visitChargePaise: settings.visitChargePaise,
      markupPct: settings.repairMarkupPct,
      courierToCustomer: settings.courierToCustomer,
      items: items.map((i) => ({
        equipmentName: i.equipmentName, serialNo: i.serialNo, status: i.status, partsFree: i.cover.parts.free,
        supplierQuotePaise: i.rma?.supplierQuotePaise ?? null, courierSharePaise: i.rma?.courierSharePaise ?? 0,
      })),
      parts: partsFree ? [] : [...used].flatMap(([pid, qty]) => asLine(pid, qty) ?? []),
      // Not a part used on the job, so it is not cut to the parts used if the office changes the bill.
      fromStock: stockLines.flatMap((l) => { const x = asLine(l.productId, l.qtyIssued); return x ? [{ ...x, productId: null }] : []; }),
    });
  }
  return { lines, fromEstimate: !!est, fromOffice, ...billTotals(lines) };
}

/**
 * THE OFFICE CHANGES THE BILL (25 Oct 2026, Vcare): add a charge of its own
 * choosing - a service charge for a visit - change a price, or take a line
 * off, on the spot and without asking the customer. Kept as an estimate the
 * office approved (`decidedVia: 'office'`), so Bill this job, the close gate
 * and the preview all read it the way they read a customer's approval, and
 * part lines still drop to what was used if parts come back.
 */
export async function setJobBill(scope: StoreScope, complaintId: string, lines: EstimateLine[], userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, invoiceId: true, status: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (job.invoiceId) throw new ComplaintError('This job is already billed - change the invoice itself while it is a draft.');
  // A job waiting on the customer's estimate goes back to work: the office has decided the price.
  const resume = job.status === 'awaiting_estimate';
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const ours = new Set((ids.length ? await db.product.findMany({ where: { id: { in: ids }, storeId }, select: { id: true } }) : []).map((p) => p.id));
  const clean: EstimateLine[] = lines
    .map((l) => ({
      description: String(l.description ?? '').trim().slice(0, 200), qty: Math.max(1, Math.trunc(Number(l.qty) || 1)),
      unitPaise: Math.max(0, Math.round(Number(l.unitPaise) || 0)),
      productId: l.productId && ours.has(l.productId) ? l.productId : null,
      taxRatePct: Math.min(28, Math.max(0, Number(l.taxRatePct ?? 18) || 0)),
    }))
    .filter((l) => l.description && l.unitPaise > 0);
  if (!clean.length) throw new ComplaintError('Keep at least one line with a price. To charge nothing, use Don\'t bill.');
  const total = estimateTotal(clean);
  await db.$transaction(async (tx) => {
    // A waiting estimate is overtaken by what the office has now set.
    await tx.jobEstimate.updateMany({ where: { complaintId, status: 'waiting' }, data: { status: 'withdrawn' } });
    await tx.jobEstimate.create({
      data: { storeId, complaintId, lines: clean as unknown as object[], totalPaise: total, note: 'Bill set by the office.', status: 'approved', decidedVia: 'office', decidedAt: new Date(), createdBy: userId },
    });
    await tx.complaint.update({ where: { id: complaintId }, data: { billingStatus: 'to_invoice', ...(resume ? { status: 'in_progress' } : {}) } });
    await logActivity(tx, complaintId, 'note', userId, {
      body: `Bill changed by the office: ${clean.map((l) => `${l.description} ${l.qty} × ₹${(l.unitPaise / 100).toLocaleString('en-IN')}`).join(', ')}. Total ₹${(total / 100).toLocaleString('en-IN')} with GST.`,
      ...(resume ? { statusFrom: 'awaiting_estimate', statusTo: 'in_progress' } : {}),
    });
  });
}

/**
 * Bill a field job: a draft invoice of `jobBillDraft`'s lines. Stock and cost
 * were already booked by the GDNs, so the invoice lines carry no product link
 * - the invoice (and cancelling or editing it) never moves stock twice. GST,
 * the receivable and sales post when the office issues the invoice, as for
 * any invoice. One invoice per job.
 */
export async function billJob(scope: StoreScope, complaintId: string, userId: string): Promise<{ id: string; invoiceNo: string }> {
  scopeForWrite(scope);
  const job = await db.complaint.findFirst({
    where: { id: complaintId, ...scopeWhere(scope) },
    select: {
      id: true, complaintNo: true, customerId: true, invoice: { select: { invoiceNo: true } },
      customer: { select: { firstName: true, lastName: true, companyName: true, email: true, phone: true, phoneCc: true, gstin: true, addressLine1: true, state: true, city: true, paymentTermsDays: true } },
    },
  });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (job.invoice) throw new ComplaintError(`This job is already billed on ${job.invoice.invoiceNo}.`);
  const draft = await jobBillDraft(scope, complaintId);
  if (!draft?.lines.length) {
    throw new ComplaintError('Nothing to bill - the AMC pays for the visits and the warranty for the parts on every item. For extra chargeable work, send an estimate first.');
  }

  const { createDirectInvoice } = await import('./invoices');
  const cu = job.customer;
  const invoice = await createDirectInvoice(scope, {
    partyId: job.customerId,
    customerName: cu.companyName || [cu.firstName, cu.lastName].filter(Boolean).join(' '),
    organizationName: cu.companyName, email: cu.email, phone: `${cu.phoneCc} ${cu.phone}`, gstin: cu.gstin,
    billingAddress: cu.addressLine1, shippingAddress: cu.addressLine1, stateId: cu.state, cityId: cu.city,
    invoiceDate: new Date(), termsDays: cu.paymentTermsDays ?? 0, poNumber: null,
    deliveryCharge: 0, deliveryExempt: true, discountType: 'amount', discountValue: 0, termsBody: null,
    notes: `Field job ${job.complaintNo}.${draft.fromOffice ? ' Charges as set by the office; parts at the quantity actually used.' : draft.fromEstimate ? ' As per the approved estimate; parts at the quantity actually used.' : ' Visits by the AMC, parts and repairs by each item\'s warranty.'}`,
    lines: draft.lines.map((l) => ({ productId: null, productName: l.description, productCode: l.productCode, hsnCode: l.hsnCode, qty: l.qty, unitPricePaise: l.unitPaise, discountPct: 0, taxRatePct: l.taxRatePct })),
  }, userId);
  await db.complaint.update({ where: { id: job.id }, data: { invoiceId: invoice.id, billingStatus: 'invoiced' } });
  // The serial units this job fitted are sold on this bill (22 Oct 2026, Vcare):
  // the bill's lines carry no product, so the unit says which bill it went on,
  // and the bill, the warranty and Product History all show its serial.
  const fitted = (await db.jobChallanLine.findMany({
    where: { challan: { complaintId, status: 'issued' } }, select: { stockUnitIds: true },
  })).flatMap((l) => l.stockUnitIds);
  if (fitted.length) {
    await db.stockUnit.updateMany({ where: { id: { in: fitted }, status: 'with_customer', invoiceId: null }, data: { invoiceId: invoice.id } });
  }
  await logActivity(db, job.id, 'note', userId, { body: `Billed on ${invoice.invoiceNo} (draft - issue it from Invoices).` });
  return { id: invoice.id, invoiceNo: invoice.invoiceNo };
}

/**
 * Don't bill (10 Oct 2026): something was chargeable and the office chooses
 * not to charge it - goodwill, a mistake on our side. Said with a reason, kept
 * on the job, and it lets the job close.
 */
export async function waiveJobBilling(scope: StoreScope, complaintId: string, reason: string, userId: string): Promise<void> {
  scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why this job is not being billed.');
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, invoiceId: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (job.invoiceId) throw new ComplaintError('This job is already billed - cancel the invoice or raise a credit note instead.');
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: job.id }, data: { billingStatus: 'waived' } });
    await logActivity(tx, job.id, 'note', userId, { body: `Not billed: ${why}` });
  });
}

/**
 * THE MONEY HALF OF THE CLOSE GATE (stage 7): what is chargeable and not yet
 * billed, before GST. Zero when billed, waived, or nothing is chargeable.
 */
export async function unbilledPaise(scope: StoreScope, complaintId: string): Promise<number> {
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { invoiceId: true, billingStatus: true } });
  if (!job || job.invoiceId || job.billingStatus === 'waived') return 0;
  return (await jobBillDraft(scope, complaintId))?.basePaise ?? 0;
}
