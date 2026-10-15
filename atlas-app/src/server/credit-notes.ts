import 'server-only';
import type { SalesReach } from './sales-reach';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { settledByInvoice, syncSettledColumn } from './settlement';
import { getInvoiceForReturn, getReturnDetail } from './sales-returns';
import {
  computeCreditTotals, creditForQty, isPastTaxCutoff, unusedCreditPaise,
  type CreditReason,
} from '@/lib/returns';
import { outstandingOn, type AllocatableInvoice } from '@/lib/allocation';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';

/** Where a refund's money actually left from, by how it was sent. */
const REFUND_CREDIT_ACCOUNT: Record<string, string> = {
  cash: '1010', bank: '1020', upi: '1020', cheque: '1020', card: '1020', adjustment: '1420',
};

/**
 * Credit notes - the money half of a return, and everything that has no goods
 * behind it at all.
 *
 * A credit note is a statutory document under section 34 of the CGST Act, not a
 * bookkeeping adjustment, and three things follow:
 *
 *   - it carries its own unbroken number series
 *   - it carries GST at the rates of the original supply, in the original
 *     supply's tax mode, and reduces output tax liability
 *   - it references the invoice it credits, permanently
 *
 * IT SETTLES INVOICES THE WAY A RECEIPT DOES
 *
 * `CreditNoteAllocation` is a deliberate mirror of `ReceiptAllocation` - signed,
 * append-only, taken back with a negative row. That is what lets a customer's
 * returned goods clear their outstanding invoices today, with no general ledger
 * in the product yet. When the GL arrives, the two allocation kinds post to
 * different accounts and nothing else about this changes.
 *
 * THE JOURNAL ENTRY, NOW THAT THE GL EXISTS
 *
 * Issuing debits Sales Returns & Allowances (a contra-revenue account, not a
 * straight reduction of Sales Revenue - the original sale is still a fact)
 * plus whichever Output CGST/SGST/IGST applied, and credits Accounts
 * Receivable. A refund is the AR side settling in cash rather than against
 * another invoice: debit AR, credit wherever the money actually left from.
 *
 * Spec: _archive/roadmap/NEXT-SPRINT.md weeks 2–4
 */

export class CreditNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditNoteError';
  }
}

const ISSUED = { lifecycle: 'issued' } as const;

// ------------------------------------------------------------------ reading

export interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  invoiceNo: string;
  salesReturnId: string | null;
  returnNo: string | null;
  partyId: string | null;
  customerName: string;
  creditNoteDate: Date;
  lifecycle: string;
  reason: string;
  taxMode: string;
  taxableBasePaise: number;
  taxTotalPaise: number;
  grandTotalPaise: number;
  allocatedPaise: number;
  refundedPaise: number;
  /** Not yet applied to an invoice and not refunded - usable credit. */
  unusedPaise: number;
  appliedTo: { invoiceId: string; invoiceNo: string; amountPaise: number }[];
}

export async function listCreditNotes(
  scope: StoreScope,
  opts: { invoiceId?: string; partyId?: string; lifecycle?: string; salesReach?: SalesReach | null } = {},
): Promise<CreditNoteRow[]> {
  const rows = await db.creditNote.findMany({
    where: {
      ...scopeWhere(scope),
      // A credit note follows its invoice's salesperson (B4 step 4).
      ...(opts.salesReach ? { invoice: opts.salesReach.where } : {}),
      ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : {}),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
      ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
    },
    orderBy: { creditNoteDate: 'desc' },
    select: {
      id: true, creditNoteNo: true, invoiceId: true, salesReturnId: true,
      partyId: true, customerName: true, creditNoteDate: true, lifecycle: true,
      reason: true, taxMode: true, taxableBasePaise: true, grandTotalPaise: true,
      cgstPaise: true, sgstPaise: true, igstPaise: true,
      invoice: { select: { invoiceNo: true } },
      salesReturn: { select: { returnNo: true } },
      allocations: {
        select: {
          invoiceId: true, amountPaise: true,
          invoice: { select: { invoiceNo: true } },
        },
      },
      refunds: { select: { amountPaise: true, status: true } },
    },
  });

  return rows.map((c) => toRow(c));
}

function toRow(c: {
  id: string; creditNoteNo: string; invoiceId: string; salesReturnId: string | null;
  partyId: string | null; customerName: string; creditNoteDate: Date; lifecycle: string;
  reason: string; taxMode: string; taxableBasePaise: number; grandTotalPaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number;
  invoice: { invoiceNo: string };
  salesReturn: { returnNo: string } | null;
  allocations: { invoiceId: string; amountPaise: number; invoice: { invoiceNo: string } }[];
  refunds: { amountPaise: number; status: string }[];
}): CreditNoteRow {
  const allocatedPaise = c.allocations.reduce((n, a) => n + a.amountPaise, 0);
  const refundedPaise = c.refunds
    .filter((r) => r.status === 'paid')
    .reduce((n, r) => n + r.amountPaise, 0);

  // Signed rows netted per invoice, so an applied-then-reversed allocation
  // shows as nothing rather than as two entries that read like two credits.
  const net = new Map<string, { invoiceNo: string; amountPaise: number }>();
  for (const a of c.allocations) {
    const prev = net.get(a.invoiceId);
    net.set(a.invoiceId, {
      invoiceNo: a.invoice.invoiceNo,
      amountPaise: (prev?.amountPaise ?? 0) + a.amountPaise,
    });
  }

  return {
    id: c.id,
    creditNoteNo: c.creditNoteNo,
    invoiceId: c.invoiceId,
    invoiceNo: c.invoice.invoiceNo,
    salesReturnId: c.salesReturnId,
    returnNo: c.salesReturn?.returnNo ?? null,
    partyId: c.partyId,
    customerName: c.customerName,
    creditNoteDate: c.creditNoteDate,
    lifecycle: c.lifecycle,
    reason: c.reason,
    taxMode: c.taxMode,
    taxableBasePaise: c.taxableBasePaise,
    taxTotalPaise: c.cgstPaise + c.sgstPaise + c.igstPaise,
    grandTotalPaise: c.grandTotalPaise,
    allocatedPaise,
    refundedPaise,
    unusedPaise: unusedCreditPaise(c.grandTotalPaise, c.allocations, c.refunds),
    appliedTo: [...net]
      .filter(([, v]) => v.amountPaise !== 0)
      .map(([invoiceId, v]) => ({ invoiceId, invoiceNo: v.invoiceNo, amountPaise: v.amountPaise })),
  };
}

export interface CreditNoteDetail extends CreditNoteRow {
  gstin: string | null;
  billingAddress: string | null;
  email: string | null;
  phone: string | null;
  reasonNote: string | null;
  notes: string | null;
  cancelReason: string | null;
  issuedAt: Date | null;
  subtotalPaise: number;
  itemDiscountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  pastTaxCutoff: boolean;
  invoiceDate: Date;
  items: {
    srNo: number;
    productId: string | null;
    productName: string;
    productCode: string | null;
    hsnCode: string | null;
    qty: number;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
    lineDiscountPaise: number;
    lineTotalPaise: number;
    taxPaise: number;
  }[];
  refunds: {
    id: string; refundNo: string; amountPaise: number; refundedAt: Date;
    method: string; reference: string | null; status: string;
  }[];
  org: { name: string; gstin: string | null; email: string | null; mobile: string | null };
  storeName: string;
}

export async function getCreditNoteDetail(
  scope: StoreScope,
  id: string,
): Promise<CreditNoteDetail | null> {
  const c = await db.creditNote.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      invoice: { select: { invoiceNo: true, invoiceDate: true } },
      salesReturn: { select: { returnNo: true } },
      allocations: {
        select: {
          invoiceId: true, amountPaise: true,
          invoice: { select: { invoiceNo: true } },
        },
      },
      refunds: { orderBy: { refundedAt: 'desc' } },
      store: { include: { organization: true } },
    },
  });
  if (!c) return null;

  const base = toRow({ ...c, invoice: { invoiceNo: c.invoice.invoiceNo } });

  return {
    ...base,
    gstin: c.gstin,
    billingAddress: c.billingAddress,
    email: c.email,
    phone: c.phone,
    reasonNote: c.reasonNote,
    notes: c.notes,
    cancelReason: c.cancelReason,
    issuedAt: c.issuedAt,
    subtotalPaise: c.subtotalPaise,
    itemDiscountPaise: c.itemDiscountPaise,
    cgstPaise: c.cgstPaise,
    sgstPaise: c.sgstPaise,
    igstPaise: c.igstPaise,
    invoiceDate: c.invoice.invoiceDate,
    pastTaxCutoff: isPastTaxCutoff(c.invoice.invoiceDate, c.creditNoteDate),
    items: c.items.map((i) => ({
      srNo: i.srNo,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      hsnCode: i.hsnCode,
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
      lineDiscountPaise: i.lineDiscountPaise,
      lineTotalPaise: i.lineTotalPaise,
      taxPaise: i.taxPaise,
    })),
    refunds: c.refunds.map((r) => ({
      id: r.id, refundNo: r.refundNo, amountPaise: r.amountPaise,
      refundedAt: r.refundedAt, method: r.method, reference: r.reference, status: r.status,
    })),
    org: {
      name: c.store.organization.name,
      gstin: c.store.organization.gstin,
      email: c.store.organization.email,
      mobile: c.store.organization.mobile,
    },
    storeName: c.store.name,
  };
}

/** Credit sitting on a customer's account, unapplied and unrefunded. */
export async function unusedCreditFor(scope: StoreScope, partyId: string): Promise<number> {
  const notes = await db.creditNote.findMany({
    where: { ...scopeWhere(scope), partyId, ...ISSUED },
    select: {
      grandTotalPaise: true,
      allocations: { select: { amountPaise: true } },
      refunds: { select: { amountPaise: true, status: true } },
    },
  });

  return notes.reduce(
    (n, c) => n + unusedCreditPaise(c.grandTotalPaise, c.allocations, c.refunds),
    0,
  );
}

// ------------------------------------------------------------------ writing

export interface CreditFromReturnInput {
  salesReturnId: string;
  creditNoteDate?: Date | null;
  reasonNote?: string | null;
  notes?: string | null;
  /** Issue it straight away and apply it. The usual case. */
  issueNow?: boolean;
}

/**
 * Raise a credit note for goods that came back.
 *
 * Every figure is computed here from the return's stored share of each invoice
 * line - nothing is taken from the browser. The client is never trusted with
 * money, and a credit note is money going the other way, which makes it the
 * one document where a manipulated total is an outright refund.
 */
export async function createCreditFromReturn(
  scope: StoreScope,
  input: CreditFromReturnInput,
  userId: string,
): Promise<{ id: string; creditNoteNo: string; grandTotalPaise: number; appliedPaise: number; awaitingApproval: boolean }> {
  const storeId = scopeForWrite(scope);

  const ret = await getReturnDetail(scope, input.salesReturnId);
  if (!ret) throw new CreditNoteError('Return not found in your scope.');
  if (ret.lifecycle === 'cancelled') {
    throw new CreditNoteError(`${ret.returnNo} has been cancelled.`);
  }
  if (ret.lifecycle !== 'received') {
    throw new CreditNoteError(
      `${ret.returnNo} has not been received yet. Mark the goods received before crediting them -`
      + ' otherwise the customer is credited for items that are still in transit.',
    );
  }

  const existing = ret.creditNotes.filter((c) => c.lifecycle !== 'cancelled');
  if (existing.length > 0) {
    throw new CreditNoteError(
      `${existing[0].creditNoteNo} already credits this return.`
      + ' Cancel it before raising another, or the customer is credited twice.',
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id: ret.invoiceId, ...scopeWhere(scope) },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, taxMode: true, partyId: true,
      customerName: true, organizationName: true, email: true, phone: true,
      gstin: true, billingAddress: true, stateId: true,
    },
  });
  if (!invoice) throw new CreditNoteError('The invoice behind this return is not in your scope.');

  /*
    The invoice's OWN answer, all three of it. `=== 'IGST' ? 'IGST' :
    'CGST_SGST'` quietly turned a no-GST invoice into an intra-state one, so
    its credit note refunded tax nobody ever paid (8 Oct 2026).
  */
  const taxMode = invoice.taxMode === 'NONE' ? 'NONE' as const : invoice.taxMode === 'IGST' ? 'IGST' as const : 'CGST_SGST' as const;

  const totals = computeCreditTotals(
    ret.items.map((i) => ({
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: i.discountPct,
      taxRatePct: i.taxRatePct,
      taxablePaise: i.creditTaxablePaise,
    })),
    taxMode,
  );

  return writeCreditNote(scope, storeId, userId, {
    invoice,
    salesReturnId: ret.id,
    taxMode,
    reason: 'goods_returned',
    reasonNote: input.reasonNote ?? null,
    notes: input.notes ?? null,
    creditNoteDate: input.creditNoteDate ?? null,
    issueNow: input.issueNow !== false,
    totals,
    lines: ret.items.map((i) => ({
      invoiceItemId: i.invoiceItemId,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      hsnCode: i.hsnCode,
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: i.discountPct,
      taxRatePct: i.taxRatePct,
    })),
  });
}

export interface AllowanceLineInput {
  invoiceItemId: string;
  /** Units being credited. For a pure allowance this can equal the invoiced qty. */
  qty: number;
}

export interface CreateAllowanceInput {
  invoiceId: string;
  reason: Exclude<CreditReason, 'goods_returned'>;
  lines: AllowanceLineInput[];
  /**
   * A flat amount off, instead of line quantities. Taxed at the weighted rate
   * of the lines it is spread over.
   */
  flatTaxablePaise?: number | null;
  reasonNote?: string | null;
  notes?: string | null;
  creditNoteDate?: Date | null;
  issueNow?: boolean;
}

/**
 * A credit note with no goods behind it - an allowance, a price correction, a
 * short supply.
 *
 * This is the case the reference app cannot record at all, because there a
 * credit note only exists as a consequence of a return document. Staff work
 * around it by discounting the *next* invoice, which understates that invoice's
 * taxable value and therefore its GST - a small, quiet, recurring tax error.
 *
 * Quantities here do NOT consume the return cap. Nothing physically came back,
 * so the goods are still returnable; only the money has moved.
 */
export async function createAllowance(
  scope: StoreScope,
  input: CreateAllowanceInput,
  userId: string,
): Promise<{ id: string; creditNoteNo: string; grandTotalPaise: number; appliedPaise: number; awaitingApproval: boolean }> {
  const storeId = scopeForWrite(scope);

  const inv = await getInvoiceForReturn(scope, input.invoiceId);
  if (!inv) throw new CreditNoteError('Invoice not found in your scope.');
  if (inv.lifecycle !== 'sent') {
    throw new CreditNoteError(
      `${inv.invoiceNo} is ${inv.lifecycle}. A credit note can only reduce an invoice that was issued.`,
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, ...scopeWhere(scope) },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, taxMode: true, partyId: true,
      customerName: true, organizationName: true, email: true, phone: true,
      gstin: true, billingAddress: true, stateId: true,
    },
  });
  if (!invoice) throw new CreditNoteError('Invoice not found in your scope.');

  // Same three-way answer as above - see the note there.
  const taxMode = invoice.taxMode === 'NONE' ? 'NONE' as const : invoice.taxMode === 'IGST' ? 'IGST' as const : 'CGST_SGST' as const;
  const byId = new Map(inv.lines.map((l) => [l.invoiceItemId, l]));

  const chosen = input.lines.filter((l) => l.qty > 0);
  if (chosen.length === 0) {
    throw new CreditNoteError('Choose at least one line to credit.');
  }

  for (const l of chosen) {
    const line = byId.get(l.invoiceItemId);
    if (!line) throw new CreditNoteError('One of the lines is not on this invoice.');
    if (l.qty > line.qty) {
      throw new CreditNoteError(
        `${line.productName}: only ${line.qty} were invoiced, so ${l.qty} cannot be credited.`,
      );
    }
  }

  // Line values first, from the invoice's own apportioned taxable figures.
  const lineTaxable = chosen.map((l) => {
    const line = byId.get(l.invoiceItemId)!;
    // returnedQty is deliberately ignored: an allowance credits value, not
    // goods, and the units may well come back separately later.
    return creditForQty({ qty: line.qty, taxablePaise: line.taxablePaise, returnedQty: 0 }, l.qty);
  });

  const totalLineTaxable = lineTaxable.reduce((a, b) => a + b, 0);

  // A flat amount is scaled down proportionally across the chosen lines, so it
  // is taxed at each line's own rate rather than at a guessed blended one.
  let scaled = lineTaxable;
  if (input.flatTaxablePaise != null && input.flatTaxablePaise > 0) {
    if (input.flatTaxablePaise > totalLineTaxable) {
      throw new CreditNoteError(
        `The amount is more than the ${rupees(totalLineTaxable)} those lines were charged at.`
        + ' A credit note cannot return more than was invoiced.',
      );
    }
    const flat = input.flatTaxablePaise;
    scaled = lineTaxable.map((t) =>
      totalLineTaxable === 0 ? 0 : Math.round((flat * t) / totalLineTaxable));
    // Remainder to the largest line, so the parts sum back to the flat amount.
    const drift = flat - scaled.reduce((a, b) => a + b, 0);
    if (drift !== 0 && scaled.length > 0) {
      const biggest = lineTaxable.indexOf(Math.max(...lineTaxable));
      scaled[biggest] += drift;
    }
  }

  const totals = computeCreditTotals(
    chosen.map((l, idx) => {
      const line = byId.get(l.invoiceItemId)!;
      return {
        qty: l.qty,
        unitPricePaise: line.unitPricePaise,
        discountPct: line.discountPct,
        taxRatePct: line.taxRatePct,
        taxablePaise: scaled[idx],
      };
    }),
    taxMode,
  );

  if (totals.grandTotalPaise <= 0) {
    throw new CreditNoteError('A credit note must be for more than zero.');
  }

  return writeCreditNote(scope, storeId, userId, {
    invoice,
    salesReturnId: null,
    taxMode,
    reason: input.reason,
    reasonNote: input.reasonNote ?? null,
    notes: input.notes ?? null,
    creditNoteDate: input.creditNoteDate ?? null,
    issueNow: input.issueNow !== false,
    totals,
    lines: chosen.map((l) => {
      const line = byId.get(l.invoiceItemId)!;
      return {
        invoiceItemId: l.invoiceItemId,
        productId: line.productId,
        productName: line.productName,
        productCode: line.productCode,
        hsnCode: line.hsnCode,
        qty: l.qty,
        unitPricePaise: line.unitPricePaise,
        discountPct: line.discountPct,
        taxRatePct: line.taxRatePct,
      };
    }),
  });
}

interface WriteInput {
  invoice: {
    id: string; invoiceNo: string; invoiceDate: Date; partyId: string | null;
    customerName: string; organizationName: string | null; email: string | null;
    phone: string; gstin: string | null; billingAddress: string | null; stateId: string | null;
  };
  salesReturnId: string | null;
  taxMode: 'CGST_SGST' | 'IGST' | 'NONE';
  reason: string;
  reasonNote: string | null;
  notes: string | null;
  creditNoteDate: Date | null;
  issueNow: boolean;
  totals: ReturnType<typeof computeCreditTotals>;
  lines: {
    invoiceItemId: string; productId: string | null; productName: string;
    productCode: string | null; hsnCode: string | null; qty: number;
    unitPricePaise: number; discountPct: number; taxRatePct: number;
  }[];
}

/**
 * Total credited against one invoice by every credit note that still stands.
 *
 * The ceiling this feeds is the last line of defence, and it exists because the
 * two credit paths cannot see each other. A goods return respects the return
 * cap; an allowance deliberately does NOT consume that cap, because nothing
 * physically came back and those units are still returnable. Both positions are
 * right on their own, and together they leave a hole: credit ₹1,000 as a damage
 * allowance, then return the same goods for another ₹1,000, and the customer is
 * paid twice for one supply.
 *
 * Rather than couple the two paths - which would mean an allowance quietly
 * eating a return allowance it has no business touching - the invariant is
 * stated at the level where it is actually true: **an invoice cannot be
 * credited for more than it was raised for.**
 */
async function creditedAgainstInvoice(
  scope: StoreScope,
  invoiceId: string,
): Promise<number> {
  const notes = await db.creditNote.findMany({
    where: { ...scopeWhere(scope), invoiceId, ...ISSUED },
    select: { grandTotalPaise: true },
  });
  return notes.reduce((n, c) => n + c.grandTotalPaise, 0);
}

async function writeCreditNote(
  scope: StoreScope,
  storeId: string,
  userId: string,
  input: WriteInput,
): Promise<{ id: string; creditNoteNo: string; grandTotalPaise: number; appliedPaise: number; awaitingApproval: boolean }> {
  // Approval rules (5 Oct 2026): when a rule says this credit note needs a
  // sign-off, it is saved as a DRAFT and the approvers are asked. It is issued
  // - and starts reducing what the customer owes - only once approved. No rule
  // saved = issued at once, exactly as before.
  const { approvalNeeded, requestApproval } = await import('./approvals');
  const awaitingApproval = input.issueNow
    && await approvalNeeded(storeId, 'credit_note', userId, input.totals.grandTotalPaise);
  const w: WriteInput = awaitingApproval ? { ...input, issueNow: false } : input;

  // Checked before a statutory number is allocated, so a refused credit note
  // does not burn one out of the sequence.
  const invoiceTotal = await db.invoice.findFirst({
    where: { id: w.invoice.id, ...scopeWhere(scope) },
    select: { grandTotalPaise: true },
  });
  const already = await creditedAgainstInvoice(scope, w.invoice.id);
  const ceiling = (invoiceTotal?.grandTotalPaise ?? 0) - already;

  if (w.totals.grandTotalPaise > ceiling) {
    throw new CreditNoteError(
      already > 0
        ? `${w.invoice.invoiceNo} has already been credited ${rupees(already)} of its`
          + ` ${rupees(invoiceTotal?.grandTotalPaise ?? 0)}, leaving ${rupees(Math.max(0, ceiling))}.`
          + ` This note is for ${rupees(w.totals.grandTotalPaise)}.`
          + ' An invoice cannot be credited for more than it was raised for -'
          + ' check whether these goods were already covered by an earlier allowance.'
        : `This credit note is for ${rupees(w.totals.grandTotalPaise)} but ${w.invoice.invoiceNo}`
          + ` was only raised for ${rupees(invoiceTotal?.grandTotalPaise ?? 0)}.`,
    );
  }

  const creditNoteNo = await allocateDocumentNumber(storeId, 'CN', w.creditNoteDate ?? undefined);

  // Where the credit will go, decided before the transaction opens so a bad
  // split refuses without having written a statutory document.
  const plan = w.issueNow
    ? await planAllocation(scope, w.invoice.partyId, w.invoice.id, w.totals.grandTotalPaise)
    : [];

  const created = await db.$transaction(async (tx) => {
    const cn = await tx.creditNote.create({
      data: {
        creditNoteNo,
        storeId,
        invoiceId: w.invoice.id,
        salesReturnId: w.salesReturnId,
        partyId: w.invoice.partyId,
        customerName: w.invoice.customerName,
        organizationName: w.invoice.organizationName,
        email: w.invoice.email,
        phone: w.invoice.phone,
        gstin: w.invoice.gstin,
        billingAddress: w.invoice.billingAddress,
        stateId: w.invoice.stateId,
        creditNoteDate: w.creditNoteDate ?? new Date(),
        lifecycle: w.issueNow ? 'issued' : 'draft',
        issuedAt: w.issueNow ? new Date() : null,
        reason: w.reason,
        reasonNote: w.reasonNote,
        notes: w.notes,
        taxMode: w.taxMode,
        subtotalPaise: w.totals.subtotalPaise,
        itemDiscountPaise: w.totals.itemDiscountPaise,
        taxableBasePaise: w.totals.taxableBasePaise,
        cgstPaise: w.totals.cgstPaise,
        sgstPaise: w.totals.sgstPaise,
        igstPaise: w.totals.igstPaise,
        grandTotalPaise: w.totals.grandTotalPaise,
        createdBy: userId,
        items: {
          create: w.lines.map((l, idx) => ({
            srNo: idx + 1,
            invoiceItemId: l.invoiceItemId,
            productId: l.productId,
            productName: l.productName,
            productCode: l.productCode,
            hsnCode: l.hsnCode,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
            discountPct: l.discountPct,
            taxRatePct: l.taxRatePct,
            lineDiscountPaise: w.totals.lines[idx]?.discountPaise ?? 0,
            lineTotalPaise: w.totals.lines[idx]?.taxablePaise ?? 0,
            taxPaise: w.totals.lines[idx]?.taxPaise ?? 0,
          })),
        },
      },
    });

    if (plan.length > 0) {
      await tx.creditNoteAllocation.createMany({
        data: plan.map((p) => ({
          creditNoteId: cn.id,
          invoiceId: p.invoiceId,
          storeId,
          amountPaise: p.amountPaise,
          allocatedBy: userId,
        })),
      });
      await syncSettledColumn(tx, storeId, plan.map((p) => p.invoiceId));
    }

    return cn;
  });

  if (awaitingApproval) {
    await requestApproval(storeId, { type: 'credit_note', entityId: created.id, requesterId: userId })
      .catch((e) => console.error('[approvals] credit note request failed', e));
  }

  return {
    id: created.id,
    creditNoteNo,
    grandTotalPaise: w.totals.grandTotalPaise,
    appliedPaise: plan.reduce((n, p) => n + p.amountPaise, 0),
    awaitingApproval,
  };
}

/**
 * Where a new credit note's value should go.
 *
 * The invoice it credits comes first, always - that is the supply being
 * reduced, and settling it elsewhere while it sits overdue is how a credit note
 * for goods somebody returned still ends up on a dunning letter. Anything left
 * over spreads across the customer's other open invoices, oldest first, exactly
 * as a receipt would. What remains after that sits on the account as usable
 * credit rather than being forced somewhere.
 */
async function planAllocation(
  scope: StoreScope,
  partyId: string | null,
  originInvoiceId: string,
  amountPaise: number,
): Promise<{ invoiceId: string; amountPaise: number }[]> {
  if (amountPaise <= 0) return [];

  const candidates = await db.invoice.findMany({
    where: {
      ...scopeWhere(scope),
      lifecycle: 'sent',
      ...(partyId ? { partyId } : { id: originInvoiceId }),
    },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, dueDate: true, grandTotalPaise: true,
    },
  });

  const settled = await settledByInvoice(scope, candidates.map((c) => c.id));
  const open: AllocatableInvoice[] = candidates
    .map((c) => ({ ...c, paidPaise: settled.get(c.id) ?? 0 }))
    .filter((c) => outstandingOn(c) > 0);

  const origin = open.filter((o) => o.id === originInvoiceId);
  const rest = open
    .filter((o) => o.id !== originInvoiceId)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()
      || a.invoiceNo.localeCompare(b.invoiceNo));

  const out: { invoiceId: string; amountPaise: number }[] = [];
  let left = amountPaise;

  for (const inv of [...origin, ...rest]) {
    if (left <= 0) break;
    const due = outstandingOn(inv);
    if (due <= 0) continue;
    const take = Math.min(left, due);
    out.push({ invoiceId: inv.id, amountPaise: take });
    left -= take;
  }

  return out;
}

/**
 * Issue a draft credit note - through the approval rules (5 Oct 2026).
 *
 * - A request is already open: pressing Issue is that person's approval, with
 *   the same checks as Waiting on me. The last level issues it.
 * - A rule says it needs approval: it stays a draft and the approvers are
 *   asked (`awaitingApproval`).
 * - Otherwise it is issued now, as before.
 */
export async function issueCreditNote(
  scope: StoreScope,
  id: string,
  userId: string,
): Promise<{ creditNoteNo: string; appliedPaise: number; awaitingApproval?: boolean }> {
  const storeId = scopeForWrite(scope);
  const cn = await db.creditNote.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { creditNoteNo: true, grandTotalPaise: true, lifecycle: true },
  });
  if (!cn) throw new CreditNoteError('Credit note not found in your scope.');

  const { openApprovalRequest } = await import('./hierarchy');
  if (cn.lifecycle === 'draft' && await openApprovalRequest(scope, 'credit_note', id)) {
    const { gateDecision } = await import('./approval-handlers');
    const final = await gateDecision(scope, 'credit_note', id, 'approved', userId, null, false);
    if (!final) return { creditNoteNo: cn.creditNoteNo, appliedPaise: 0, awaitingApproval: true };
    return issueApprovedCreditNote(scope, id, userId);
  }

  const { approvalNeeded, requestApproval } = await import('./approvals');
  if (cn.lifecycle === 'draft' && await approvalNeeded(storeId, 'credit_note', userId, cn.grandTotalPaise)) {
    await requestApproval(storeId, { type: 'credit_note', entityId: id, requesterId: userId });
    return { creditNoteNo: cn.creditNoteNo, appliedPaise: 0, awaitingApproval: true };
  }
  return issueApprovedCreditNote(scope, id, userId);
}

/**
 * Issue a draft credit note, and apply it. Called once nothing stands in the
 * way: no rule, or the approval is complete (approval-handlers).
 */
export async function issueApprovedCreditNote(
  scope: StoreScope,
  id: string,
  userId: string,
): Promise<{ creditNoteNo: string; appliedPaise: number }> {
  const storeId = scopeForWrite(scope);

  const cn = await db.creditNote.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true,
      invoiceId: true, partyId: true, customerName: true, creditNoteDate: true,
      taxableBasePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
    },
  });
  if (!cn) throw new CreditNoteError('Credit note not found in your scope.');
  if (cn.lifecycle === 'cancelled') throw new CreditNoteError(`${cn.creditNoteNo} was cancelled.`);
  if (cn.lifecycle === 'issued') throw new CreditNoteError(`${cn.creditNoteNo} is already issued.`);

  // Re-checked here, not only at creation. A draft can sit for weeks while
  // another credit note against the same invoice is raised and issued, so the
  // ceiling that held when this was drafted may not hold now.
  const invoice = await db.invoice.findFirst({
    where: { id: cn.invoiceId, ...scopeWhere(scope) },
    select: { invoiceNo: true, grandTotalPaise: true },
  });
  const already = await creditedAgainstInvoice(scope, cn.invoiceId);
  const ceiling = (invoice?.grandTotalPaise ?? 0) - already;

  if (cn.grandTotalPaise > ceiling) {
    throw new CreditNoteError(
      `${invoice?.invoiceNo ?? 'That invoice'} has been credited ${rupees(already)} since this`
      + ` draft was written, leaving ${rupees(Math.max(0, ceiling))} - less than this note's`
      + ` ${rupees(cn.grandTotalPaise)}. An invoice cannot be credited for more than it was`
      + ' raised for. Cancel this draft, or reduce it.',
    );
  }

  const plan = await planAllocation(scope, cn.partyId, cn.invoiceId, cn.grandTotalPaise);

  await db.$transaction(async (tx) => {
    const updated = await tx.creditNote.updateMany({
      where: { id, storeId, lifecycle: 'draft' },
      data: { lifecycle: 'issued', issuedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new CreditNoteError('This credit note was issued by somebody else a moment ago.');
    }

    if (plan.length > 0) {
      await tx.creditNoteAllocation.createMany({
        data: plan.map((p) => ({
          creditNoteId: id, invoiceId: p.invoiceId, storeId,
          amountPaise: p.amountPaise, allocatedBy: userId,
        })),
      });
    }
    // Synced even with an empty plan: `issued` is what makes existing
    // allocations count, so the column must be recomputed either way.
    await syncSettledColumn(tx, storeId, [cn.invoiceId, ...plan.map((p) => p.invoiceId)]);
  });

  // Posted AFTER the transaction, not before: this function has its own
  // optimistic-concurrency race (two people issuing the same draft at once),
  // and the `updated.count === 0` check above is what decides which caller
  // actually won it. Posting first would mean the loser had already written
  // a journal entry for a credit note it never actually issued.
  const lines: LedgerLineInput[] = [];
  if (cn.taxableBasePaise > 0) lines.push({ accountCode: '4020', debitPaise: cn.taxableBasePaise });
  if (cn.cgstPaise > 0) lines.push({ accountCode: '2210', debitPaise: cn.cgstPaise });
  if (cn.sgstPaise > 0) lines.push({ accountCode: '2220', debitPaise: cn.sgstPaise });
  if (cn.igstPaise > 0) lines.push({ accountCode: '2230', debitPaise: cn.igstPaise });
  lines.push({
    accountCode: '1100', creditPaise: cn.grandTotalPaise, partyId: cn.partyId, description: cn.customerName,
  });

  await postJournalEntry(scope, {
    entryDate: cn.creditNoteDate,
    description: `Credit note ${cn.creditNoteNo} - ${cn.customerName}`,
    sourceType: 'credit_note',
    sourceId: cn.id,
    lines,
  }, userId);

  return {
    creditNoteNo: cn.creditNoteNo,
    appliedPaise: plan.reduce((n, p) => n + p.amountPaise, 0),
  };
}

/**
 * Apply credit that is sitting unused to a chosen invoice.
 *
 * Separate from issuing, because unapplied credit is a normal state: a customer
 * returns goods in March and decides in May which invoice it should clear.
 */
export async function applyCredit(
  scope: StoreScope,
  creditNoteId: string,
  invoiceId: string,
  amountPaise: number,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (amountPaise <= 0) throw new CreditNoteError('Enter an amount greater than zero.');

  const cn = await db.creditNote.findFirst({
    where: { id: creditNoteId, ...scopeWhere(scope) },
    select: {
      id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true, partyId: true,
      allocations: { select: { amountPaise: true } },
      refunds: { select: { amountPaise: true, status: true } },
    },
  });
  if (!cn) throw new CreditNoteError('Credit note not found in your scope.');
  if (cn.lifecycle !== 'issued') {
    throw new CreditNoteError(`${cn.creditNoteNo} is a ${cn.lifecycle}. Only an issued credit note settles anything.`);
  }

  const free = unusedCreditPaise(cn.grandTotalPaise, cn.allocations, cn.refunds);
  if (amountPaise > free) {
    throw new CreditNoteError(
      `${cn.creditNoteNo} has ${rupees(free)} left. ${rupees(amountPaise)} cannot be applied from it.`,
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, ...scopeWhere(scope), lifecycle: 'sent' },
    select: { id: true, invoiceNo: true, grandTotalPaise: true, partyId: true },
  });
  if (!invoice) throw new CreditNoteError('Invoice not found, or it has not been issued.');

  // Credit belongs to a customer. Applying one customer's credit note to
  // another's invoice would settle a debt with somebody else's money - which
  // reads as paid on both accounts and reconciles on neither.
  if (cn.partyId && invoice.partyId && cn.partyId !== invoice.partyId) {
    throw new CreditNoteError(
      `${invoice.invoiceNo} belongs to a different customer. Credit can only settle the account it was raised on.`,
    );
  }

  const settled = await settledByInvoice(scope, [invoiceId]);
  const due = Math.max(0, invoice.grandTotalPaise - (settled.get(invoiceId) ?? 0));
  if (amountPaise > due) {
    throw new CreditNoteError(
      due === 0
        ? `${invoice.invoiceNo} is already settled in full.`
        : `${invoice.invoiceNo} only has ${rupees(due)} outstanding.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.creditNoteAllocation.create({
      data: { creditNoteId, invoiceId, storeId, amountPaise, allocatedBy: userId },
    });
    await syncSettledColumn(tx, storeId, [invoiceId]);
  });
}

/** Take credit back off an invoice with a negative row, never a delete. */
export async function unapplyCredit(
  scope: StoreScope,
  creditNoteId: string,
  invoiceId: string,
  amountPaise: number,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new CreditNoteError('Say why this is being taken back. It goes on the record.');
  if (amountPaise <= 0) throw new CreditNoteError('Enter an amount greater than zero.');

  const rows = await db.creditNoteAllocation.findMany({
    where: { ...scopeWhere(scope), creditNoteId, invoiceId },
    select: { amountPaise: true },
  });
  const applied = rows.reduce((n, r) => n + r.amountPaise, 0);

  if (amountPaise > applied) {
    throw new CreditNoteError(
      `Only ${rupees(applied)} of this credit note is applied to that invoice.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.creditNoteAllocation.create({
      data: {
        creditNoteId, invoiceId, storeId,
        amountPaise: -amountPaise,
        reason: reason.trim(),
        allocatedBy: userId,
      },
    });
    await syncSettledColumn(tx, storeId, [invoiceId]);
  });
}

/**
 * Withdraw a credit note.
 *
 * The document is marked, never deleted - its number is part of a statutory
 * sequence, and a missing CN-0008 is a question nobody can answer at audit.
 * Allocations stay too; they stop counting because `settledByInvoice` filters
 * on lifecycle, so every invoice it was settling reopens by itself.
 */
export async function cancelCreditNote(
  scope: StoreScope,
  id: string,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new CreditNoteError('Say why this credit note is being cancelled.');

  const cn = await db.creditNote.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, creditNoteNo: true, lifecycle: true, invoiceId: true,
      allocations: { select: { invoiceId: true } },
      refunds: { select: { refundNo: true, status: true } },
    },
  });
  if (!cn) throw new CreditNoteError('Credit note not found in your scope.');
  if (cn.lifecycle === 'cancelled') throw new CreditNoteError(`${cn.creditNoteNo} is already cancelled.`);

  // Money has physically left. Cancelling the document that justified it would
  // leave a payment out of the business with nothing behind it.
  const paid = cn.refunds.filter((r) => r.status === 'paid');
  if (paid.length > 0) {
    throw new CreditNoteError(
      `${paid.map((r) => r.refundNo).join(', ')} has already been refunded against this credit note.`
      + ' Reverse the refund first.',
    );
  }

  // A draft was never posted, so there is nothing to find and nothing to
  // reverse - only an issued credit note reaches `issueCreditNote`'s posting.
  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'credit_note', sourceId: cn.id, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Credit note ${cn.creditNoteNo} cancelled: ${reason.trim()}`);
  }

  await db.$transaction(async (tx) => {
    await tx.creditNote.updateMany({
      where: { id, storeId, lifecycle: { not: 'cancelled' } },
      data: { lifecycle: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
    await syncSettledColumn(tx, storeId, [
      cn.invoiceId, ...cn.allocations.map((a) => a.invoiceId),
    ]);
  });
}

// ------------------------------------------------------------------ refunds

export async function recordRefund(
  scope: StoreScope,
  input: {
    creditNoteId: string;
    amountPaise: number;
    method: string;
    refundedAt?: Date | null;
    reference?: string | null;
    note?: string | null;
  },
  userId: string,
): Promise<{ id: string; refundNo: string }> {
  const storeId = scopeForWrite(scope);
  if (input.amountPaise <= 0) throw new CreditNoteError('Enter an amount greater than zero.');

  const cn = await db.creditNote.findFirst({
    where: { id: input.creditNoteId, ...scopeWhere(scope) },
    select: {
      id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true, partyId: true,
      customerName: true,
      allocations: { select: { amountPaise: true } },
      refunds: { select: { amountPaise: true, status: true } },
    },
  });
  if (!cn) throw new CreditNoteError('Credit note not found in your scope.');
  if (cn.lifecycle !== 'issued') {
    throw new CreditNoteError(`${cn.creditNoteNo} is a ${cn.lifecycle}. Only an issued credit note can be refunded.`);
  }
  if (!cn.partyId) {
    throw new CreditNoteError('This credit note has no customer on it, so there is nobody to refund.');
  }

  const free = unusedCreditPaise(cn.grandTotalPaise, cn.allocations, cn.refunds);
  if (input.amountPaise > free) {
    throw new CreditNoteError(
      free <= 0
        ? `${cn.creditNoteNo} has been fully applied to invoices. Take the credit back off an invoice before refunding it.`
        : `${cn.creditNoteNo} has ${rupees(free)} available to refund, not ${rupees(input.amountPaise)}.`,
    );
  }

  const refundNo = await allocateDocumentNumber(storeId, 'RF', input.refundedAt ?? undefined);

  const r = await db.refund.create({
    data: {
      refundNo,
      storeId,
      creditNoteId: cn.id,
      partyId: cn.partyId,
      amountPaise: input.amountPaise,
      refundedAt: input.refundedAt ?? new Date(),
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
      recordedBy: userId,
    },
  });

  // Debits Accounts Receivable - settling the credit note's AR entry the
  // way cash does, rather than against another invoice - and credits
  // wherever the money actually left from.
  const lines: LedgerLineInput[] = [
    { accountCode: '1100', debitPaise: input.amountPaise, partyId: cn.partyId, description: cn.customerName },
    {
      accountCode: REFUND_CREDIT_ACCOUNT[input.method] ?? '1020',
      creditPaise: input.amountPaise, description: cn.customerName,
    },
  ];
  await postJournalEntry(scope, {
    entryDate: input.refundedAt ?? new Date(),
    description: `Refund ${refundNo} - ${cn.customerName}`,
    sourceType: 'refund',
    sourceId: r.id,
    lines,
  }, userId);

  return { id: r.id, refundNo };
}

/** The transfer failed or the cheque bounced - the credit becomes usable again. */
export async function reverseRefund(
  scope: StoreScope,
  refundId: string,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new CreditNoteError('Say why this refund is being reversed.');

  const r = await db.refund.findFirst({
    where: { id: refundId, ...scopeWhere(scope) },
    select: { id: true, refundNo: true, status: true },
  });
  if (!r) throw new CreditNoteError('Refund not found in your scope.');
  if (r.status !== 'paid') throw new CreditNoteError(`${r.refundNo} is already ${r.status}.`);

  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'refund', sourceId: r.id, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Refund ${r.refundNo} reversed: ${reason.trim()}`);
  }

  await db.refund.updateMany({
    where: { id: refundId, storeId, status: 'paid' },
    data: { status: 'reversed', reversedAt: new Date(), reversalReason: reason.trim() },
  });
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
