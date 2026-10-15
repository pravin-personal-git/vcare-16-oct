import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { expiryState, addDays, addMonths, daysBetween, startOfDay } from '@/lib/expiry';
import {
  resolveCoverage, resolveSplitCover, type Coverage, type CoverageContract, type CoverageEquipment, type SplitCover,
} from '@/lib/amc-coverage';
import {
  AMC_STATUSES, AMC_STATUS_LABEL, AMC_TRANSITIONS, COVERAGE_TERMS,
  type AmcStatus,
} from '@/lib/amc-status';
import {
  planContractsForInvoice, billingState, visitAllowance,
  type AmcOffer, type BillingState, type VisitAllowance,
} from '@/lib/amc-offer';
import { contractNeedsTaxRate, requireAmcTaxRate } from '@/lib/amc-tax';
import { createDirectInvoice } from './invoices';

/**
 * Annual maintenance contracts, and the question they exist to answer.
 *
 * WHAT THIS IS FOR
 *
 * Two jobs, and the second is the one that pays for the first:
 *
 *   1. Know which customers hold cover, for how long, and for how much - so a
 *      contract that is about to lapse gets renewed instead of forgotten.
 *   2. Answer "who pays for this service call" before a technician is sent,
 *      rather than after an argument at the counter.
 *
 * THIS MODULE STARTS EMPTY, DELIBERATELY
 *
 * The Vcare import carried exactly one AMC-shaped record: a single
 * "ANNUAL MAINTENANCE CHARGES" line on one invoice, Rs 24,000, and zero rows
 * in PolicyRenewal. So there is no history to show here on day one. That is a
 * property of the source data, not a gap in the build, and it is written down
 * because the opposite assumption - that a migrated tenant's screens should
 * arrive full - is what the challan work spent two rounds correcting.
 *
 * WHY THE RULES LIVE IN lib/
 *
 * `resolveCoverage` and the expiry arithmetic are pure functions in
 * lib/amc-coverage and lib/expiry, tested directly. Per CLAUDE.md the things
 * to test hardest are the date and money rules, and "who pays" is both. This
 * file is the part that cannot be pure: reading rows and writing them.
 */

export class AmcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmcError';
  }
}

/**
 * The vocabulary lives in lib/amc-status so the screen can import it too - this
 * module is `server-only`, and a client component reading a runtime value from
 * it fails the build. Re-exported here so server callers have one import.
 */
export {
  AMC_STATUSES, AMC_STATUS_LABEL, COVERAGE_TERMS, COVERAGE_TERMS_LABEL,
  type AmcStatus,
} from '@/lib/amc-status';

export interface AmcContractRow {
  id: string;
  contractNo: string;
  legacyRef: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  siteLabel: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  startDate: Date;
  endDate: Date;
  amountPaise: number;
  status: string;
  coverageTerms: string;
  visitsIncluded: number | null;
  reminderDays: number;
  /**
   * The GST rate this contract is billed at, as a person typed it. Null means
   * nobody has entered one yet, and the contract cannot be invoiced until they
   * do - see lib/amc-tax for why there is no default.
   */
  taxRatePct: number | null;
  /** The SAC code the AMC is billed under, if one was entered. */
  sacCode: string | null;
  notes: string | null;
  renewedFromId: string | null;
  /** True when a later contract already continues this one. */
  isRenewed: boolean;
  itemCount: number;
  /** Empty means site-wide - see AmcContractItem in the schema. */
  coveredProducts: string[];
  daysToExpiry: number;
  isDue: boolean;
  isOverdue: boolean;
  /** Whether the fee still needs an invoice. Derived - see lib/amc-offer. */
  billing: BillingState;
  /** The product sale this came from, when it was created automatically. */
  originInvoiceId: string | null;
  originInvoiceNo: string | null;
  /** The AMC terms as agreed, snapshotted at signing. */
  coverageNote: string | null;
  /** How much of the visit allowance is left. Counted, never tallied. */
  allowance: VisitAllowance;
}

const partyName = (p: {
  title: string | null; firstName: string; lastName: string | null; companyName: string | null;
}) => p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();

export async function listAmcContracts(
  scope: StoreScope,
  opts: { status?: string; customerId?: string } = {},
): Promise<AmcContractRow[]> {
  const rows = await db.amcContract.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
    include: {
      customer: {
        select: {
          title: true, firstName: true, lastName: true, companyName: true,
          phone: true, phoneCc: true,
        },
      },
      invoice: { select: { invoiceNo: true } },
      originInvoice: { select: { invoiceNo: true } },
      items: { select: { productName: true } },
      _count: {
        select: {
          renewedTo: true,
          // Only COMPLETED visits draw on the allowance. A visit that was
          // booked and never made must not cost the customer one.
          visits: { where: { status: 'completed' } },
        },
      },
    },
    // Soonest to expire first. This screen's whole point is what needs doing
    // next, and a renewal that is already overdue is the most urgent row on it.
    orderBy: { endDate: 'asc' },
    take: LIST_MAX_ROWS,
  });

  return rows.map((r) => ({
    id: r.id,
    contractNo: r.contractNo,
    legacyRef: r.legacyRef,
    customerId: r.customerId,
    customerName: partyName(r.customer),
    customerPhone: r.customer.phone ? `${r.customer.phoneCc} ${r.customer.phone}` : null,
    siteLabel: r.siteLabel,
    invoiceId: r.invoiceId,
    invoiceNo: r.invoice?.invoiceNo ?? null,
    startDate: r.startDate,
    endDate: r.endDate,
    amountPaise: r.amountPaise,
    status: r.status,
    coverageTerms: r.coverageTerms,
    visitsIncluded: r.visitsIncluded,
    reminderDays: r.reminderDays,
    taxRatePct: r.taxRatePct !== null ? r.taxRatePct.toNumber() : null,
    sacCode: r.sacCode,
    notes: r.notes,
    renewedFromId: r.renewedFromId,
    isRenewed: r._count.renewedTo > 0,
    itemCount: r.items.length,
    coveredProducts: r.items.map((i) => i.productName),
    billing: billingState({ amountPaise: r.amountPaise, invoiceId: r.invoiceId }),
    originInvoiceId: r.originInvoiceId,
    originInvoiceNo: r.originInvoice?.invoiceNo ?? null,
    coverageNote: r.coverageNote,
    allowance: visitAllowance({
      visitsIncluded: r.visitsIncluded,
      visitsUsed: r._count.visits,
    }),
    ...expiryState({ expiryDate: r.endDate, reminderDays: r.reminderDays }),
  }));
}

export interface AmcTotals {
  total: number;
  byStatus: Record<string, number>;
  /** Active contracts inside their reminder window, not yet expired. */
  dueForRenewal: number;
  /** Active contracts already past their end date - cover nobody has renewed. */
  lapsed: number;
  /** Annual contract value of everything currently active. */
  activeValuePaise: number;
  /**
   * Contracts with a fee that nobody has invoiced yet.
   *
   * The number that matters most on this screen: an AMC sold and never billed
   * is revenue the business agreed to and then forgot to ask for. Counted over
   * every contract in scope, not over the loaded page.
   */
  awaitingInvoice: number;
  awaitingInvoicePaise: number;
}

/**
 * The figures for the whole scope, counted independently of the rows.
 *
 * Same separation as the invoice and customer screens: a header that adds up
 * whatever rows it was handed is the bug that made a 3,380-invoice store
 * report 500. The lists are uncapped now, but the separation is what stops
 * that returning.
 */
export async function summariseAmcContracts(scope: StoreScope): Promise<AmcTotals> {
  const rows = await db.amcContract.findMany({
    where: scopeWhere(scope),
    select: {
      status: true, endDate: true, reminderDays: true,
      amountPaise: true, invoiceId: true,
    },
  });

  const byStatus: Record<string, number> = {};
  for (const s of AMC_STATUSES) byStatus[s] = 0;

  let dueForRenewal = 0;
  let lapsed = 0;
  let activeValuePaise = 0;
  let awaitingInvoice = 0;
  let awaitingInvoicePaise = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    // Unbilled money is worth knowing about on a cancelled contract too - the
    // work may already have been done - so this is counted outside the
    // active-only branch below.
    if (r.status !== 'cancelled'
      && billingState({ amountPaise: r.amountPaise, invoiceId: r.invoiceId }) === 'awaiting_invoice') {
      awaitingInvoice++;
      awaitingInvoicePaise += r.amountPaise;
    }

    if (r.status !== 'active') continue;
    activeValuePaise += r.amountPaise;
    const s = expiryState({ expiryDate: r.endDate, reminderDays: r.reminderDays });
    if (s.isOverdue) lapsed++;
    else if (s.isDue) dueForRenewal++;
  }

  return {
    total: rows.length, byStatus, dueForRenewal, lapsed, activeValuePaise,
    awaitingInvoice, awaitingInvoicePaise,
  };
}

export interface AmcContractDetail extends AmcContractRow {
  items: {
    id: string; srNo: number; productId: string | null; productName: string;
    qty: number; serialNo: string | null;
  }[];
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** The contract this one renewed, if any - for following the chain back. */
  renewedFromNo: string | null;
  /** And the one that continues it, for following the chain forward. */
  renewedToNo: string | null;
  renewedToId: string | null;
  /**
   * Every visit drawn from this contract, newest first.
   *
   * The answer to "what have we actually done for this customer" - which is
   * the question a renewal conversation turns on, and the reason the allowance
   * is worth counting at all.
   */
  visits: {
    id: string; purpose: string; status: string;
    scheduledAt: Date; completedAt: Date | null; outcomeNote: string | null;
    technicianName: string; complaintId: string | null; complaintNo: string | null;
  }[];
}

export async function getAmcContractDetail(
  scope: StoreScope,
  id: string,
): Promise<AmcContractDetail | null> {
  const c = await db.amcContract.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      customer: {
        select: {
          title: true, firstName: true, lastName: true, companyName: true,
          phone: true, phoneCc: true,
        },
      },
      invoice: { select: { invoiceNo: true } },
      originInvoice: { select: { invoiceNo: true } },
      items: { orderBy: { srNo: 'asc' } },
      renewedFrom: { select: { contractNo: true } },
      renewedTo: { select: { id: true, contractNo: true, startDate: true, endDate: true } },
      visits: {
        orderBy: { scheduledAt: 'desc' },
        select: {
          id: true, purpose: true, status: true, scheduledAt: true, completedAt: true,
          outcomeNote: true,
          technician: { select: { fullName: true } },
          complaint: { select: { id: true, complaintNo: true } },
        },
      },
      _count: {
        select: { renewedTo: true, visits: { where: { status: 'completed' } } },
      },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    contractNo: c.contractNo,
    legacyRef: c.legacyRef,
    customerId: c.customerId,
    customerName: partyName(c.customer),
    customerPhone: c.customer.phone ? `${c.customer.phoneCc} ${c.customer.phone}` : null,
    siteLabel: c.siteLabel,
    invoiceId: c.invoiceId,
    invoiceNo: c.invoice?.invoiceNo ?? null,
    startDate: c.startDate,
    endDate: c.endDate,
    amountPaise: c.amountPaise,
    status: c.status,
    coverageTerms: c.coverageTerms,
    visitsIncluded: c.visitsIncluded,
    reminderDays: c.reminderDays,
    taxRatePct: c.taxRatePct !== null ? c.taxRatePct.toNumber() : null,
    sacCode: c.sacCode,
    notes: c.notes,
    renewedFromId: c.renewedFromId,
    renewedFromNo: c.renewedFrom?.contractNo ?? null,
    isRenewed: c._count.renewedTo > 0,
    itemCount: c.items.length,
    coveredProducts: c.items.map((i) => i.productName),
    items: c.items.map((i) => ({
      id: i.id, srNo: i.srNo, productId: i.productId,
      productName: i.productName, qty: i.qty, serialNo: i.serialNo,
    })),
    cancelledAt: c.cancelledAt,
    cancelReason: c.cancelReason,
    billing: billingState({ amountPaise: c.amountPaise, invoiceId: c.invoiceId }),
    originInvoiceId: c.originInvoiceId,
    originInvoiceNo: c.originInvoice?.invoiceNo ?? null,
    coverageNote: c.coverageNote,
    renewedToNo: c.renewedTo[0]?.contractNo ?? null,
    renewedToId: c.renewedTo[0]?.id ?? null,
    allowance: visitAllowance({
      visitsIncluded: c.visitsIncluded,
      visitsUsed: c._count.visits,
    }),
    visits: c.visits.map((v) => ({
      id: v.id,
      purpose: v.purpose,
      status: v.status,
      scheduledAt: v.scheduledAt,
      completedAt: v.completedAt,
      outcomeNote: v.outcomeNote,
      technicianName: v.technician.fullName,
      /*
        A contract visit is always a complaint's - `completeVisit` only
        stamps a contract when the visit resolved against the customer's
        cover, and an installation visit never does (a contract covers
        servicing what they own, not fitting it). The nulls below are the
        type being honest, not a case that happens.
      */
      complaintId: v.complaint?.id ?? null,
      complaintNo: v.complaint?.complaintNo ?? null,
    })),
    ...expiryState({ expiryDate: c.endDate, reminderDays: c.reminderDays }),
  };
}

export interface AmcContractInput {
  customerId: string;
  siteLabel: string | null;
  invoiceId: string | null;
  startDate: Date;
  endDate: Date;
  amountPaise: number;
  coverageTerms: string;
  visitsIncluded: number | null;
  reminderDays: number;
  /**
   * Typed in by hand on the form. Null is acceptable only when the contract
   * has no fee - see `contractNeedsTaxRate`. Parsed by `parseTaxRatePct`
   * before it gets this far, and range-checked again in `validate`.
   */
  taxRatePct: number | null;
  sacCode: string | null;
  notes: string | null;
  legacyRef: string | null;
  /** Empty = site-wide cover. See AmcContractItem in the schema. */
  items: { productId: string | null; productName: string; qty: number; serialNo: string | null }[];
}

function validate(input: AmcContractInput) {
  if (!input.customerId) throw new AmcError('Choose the customer this contract covers.');

  if (Number.isNaN(input.startDate.getTime()) || Number.isNaN(input.endDate.getTime())) {
    throw new AmcError('Both start and end dates are required.');
  }

  // Strictly after, not on or after: a contract that starts and ends the same
  // day covers one day, which is a typo every time rather than a product.
  if (daysBetween(input.startDate, input.endDate) < 1) {
    throw new AmcError('The end date must be after the start date.');
  }

  if (input.amountPaise < 0) throw new AmcError('The amount cannot be negative.');
  if (input.reminderDays < 0) throw new AmcError('Reminder days cannot be negative.');

  // Checked here as well as in `parseTaxRatePct`, because this function is
  // also reachable from a server action that was passed a number directly, and
  // an out-of-range rate ends up on a tax document.
  if (input.taxRatePct === null && contractNeedsTaxRate(input.amountPaise)) {
    throw new AmcError(
      'Enter the GST rate this contract is billed at. Type 0 if it is exempt - '
      + 'there is no default, on purpose.',
    );
  }
  if (input.taxRatePct !== null) {
    if (input.taxRatePct < 0) throw new AmcError('The GST rate cannot be negative.');
    if (input.taxRatePct > 100) throw new AmcError('The GST rate cannot be above 100%.');
  }

  if (input.visitsIncluded !== null && input.visitsIncluded < 0) {
    throw new AmcError('Visits included cannot be negative. Leave it blank for unlimited.');
  }

  if (!COVERAGE_TERMS.includes(input.coverageTerms as (typeof COVERAGE_TERMS)[number])) {
    throw new AmcError(`Unknown coverage terms "${input.coverageTerms}".`);
  }

  for (const it of input.items) {
    if (!it.productName.trim()) throw new AmcError('Every covered line needs a product name.');
    if (it.qty < 1) throw new AmcError(`Quantity on "${it.productName}" must be at least 1.`);
  }
}

export async function createAmcContract(scope: StoreScope, input: AmcContractInput, userId?: string) {
  const storeId = scopeForWrite(scope);
  validate(input);

  // Scoped existence check before anything is written. `customerId` arrives
  // from a form, and a party id from another tenant would otherwise create a
  // contract pointing across the boundary - the leak the store-scope test
  // suite exists to prevent.
  const customer = await db.party.findFirst({
    where: { id: input.customerId, storeId },
    select: { id: true },
  });
  if (!customer) throw new AmcError('That customer is not in your scope.');

  if (input.invoiceId) {
    const invoice = await db.invoice.findFirst({
      where: { id: input.invoiceId, storeId },
      select: { id: true },
    });
    if (!invoice) throw new AmcError('That invoice is not in your scope.');
  }

  const contractNo = await allocateDocumentNumber(storeId, 'AMC');

  return db.amcContract.create({
    data: {
      storeId,
      contractNo,
      legacyRef: input.legacyRef?.trim() || null,
      customerId: input.customerId,
      siteLabel: input.siteLabel?.trim() || null,
      invoiceId: input.invoiceId,
      startDate: input.startDate,
      endDate: input.endDate,
      amountPaise: input.amountPaise,
      coverageTerms: input.coverageTerms,
      visitsIncluded: input.visitsIncluded,
      reminderDays: input.reminderDays,
      taxRatePct: input.taxRatePct,
      sacCode: input.sacCode?.trim() || null,
      notes: input.notes?.trim() || null,
      createdBy: userId ?? null,
      items: {
        create: input.items.map((it, i) => ({
          productId: it.productId,
          productName: it.productName.trim(),
          qty: it.qty,
          serialNo: it.serialNo?.trim() || null,
          srNo: i + 1,
        })),
      },
    },
  });
}

export async function updateAmcContract(
  scope: StoreScope,
  id: string,
  input: AmcContractInput,
) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const existing = await db.amcContract.findFirst({
    where: { id, storeId },
    select: { id: true, status: true },
  });
  if (!existing) throw new AmcError('That contract is not in your scope.');
  if (existing.status === 'cancelled') {
    throw new AmcError('A cancelled contract cannot be edited. Create a new one instead.');
  }

  const customer = await db.party.findFirst({
    where: { id: input.customerId, storeId },
    select: { id: true },
  });
  if (!customer) throw new AmcError('That customer is not in your scope.');

  // Lines are replaced wholesale rather than diffed. They carry no history of
  // their own - no approvals, no stock movements, nothing points at them - so
  // a diff would be machinery with no benefit. In ONE transaction, because a
  // contract that lost its lines and failed before writing the new ones would
  // silently become site-wide, which is the widest cover there is.
  return db.$transaction(async (tx) => {
    await tx.amcContractItem.deleteMany({ where: { contractId: id } });
    return tx.amcContract.update({
      where: { id },
      data: {
        legacyRef: input.legacyRef?.trim() || null,
        customerId: input.customerId,
        siteLabel: input.siteLabel?.trim() || null,
        invoiceId: input.invoiceId,
        startDate: input.startDate,
        endDate: input.endDate,
        amountPaise: input.amountPaise,
        coverageTerms: input.coverageTerms,
        visitsIncluded: input.visitsIncluded,
        reminderDays: input.reminderDays,
        taxRatePct: input.taxRatePct,
        sacCode: input.sacCode?.trim() || null,
        notes: input.notes?.trim() || null,
        items: {
          create: input.items.map((it, i) => ({
            productId: it.productId,
            productName: it.productName.trim(),
            qty: it.qty,
            serialNo: it.serialNo?.trim() || null,
            srNo: i + 1,
          })),
        },
      },
    });
  });
}

export async function setAmcStatus(
  scope: StoreScope,
  id: string,
  next: AmcStatus,
  opts: { reason?: string } = {},
) {
  const storeId = scopeForWrite(scope);

  const c = await db.amcContract.findFirst({
    where: { id, storeId },
    select: { id: true, status: true, contractNo: true },
  });
  if (!c) throw new AmcError('That contract is not in your scope.');

  const from = c.status as AmcStatus;
  if (from === next) return c;

  if (!AMC_TRANSITIONS[from]?.includes(next)) {
    throw new AmcError(
      `${c.contractNo} cannot go from ${AMC_STATUS_LABEL[from] ?? from} `
      + `to ${AMC_STATUS_LABEL[next] ?? next}.`,
    );
  }

  // A cancellation with no reason is an unanswerable question in three months'
  // time - the same rule the installation challans apply to a rejection.
  if (next === 'cancelled' && !opts.reason?.trim()) {
    throw new AmcError('Say why this contract is being cancelled.');
  }

  return db.amcContract.update({
    where: { id },
    data: {
      status: next,
      cancelledAt: next === 'cancelled' ? new Date() : null,
      cancelReason: next === 'cancelled' ? opts.reason!.trim() : null,
    },
  });
}

/**
 * Renew a contract: a NEW row that points back at the old one.
 *
 * Not an edit of the dates on the existing contract. The old period is what
 * was invoiced and what covered last year's service calls - overwriting it
 * would change the answer `resolveCoverage` gives for work already done, and
 * an invoice raised as "covered under AMC-0001" would stop matching the
 * contract it names. Same reasoning as keeping `legacyRef` rather than
 * renumbering.
 */
export async function renewAmcContract(
  scope: StoreScope,
  id: string,
  opts: { months?: number; amountPaise?: number; userId?: string } = {},
) {
  const storeId = scopeForWrite(scope);

  const old = await db.amcContract.findFirst({
    where: { id, storeId },
    include: { items: { orderBy: { srNo: 'asc' } }, _count: { select: { renewedTo: true } } },
  });
  if (!old) throw new AmcError('That contract is not in your scope.');
  if (old.status === 'cancelled') {
    throw new AmcError('A cancelled contract cannot be renewed.');
  }
  if (old._count.renewedTo > 0) {
    throw new AmcError(`${old.contractNo} has already been renewed.`);
  }

  const months = opts.months ?? 12;
  if (months < 1) throw new AmcError('A renewal must run for at least a month.');

  /**
   * The new period starts the day after the old one ends, so there is no gap
   * and no overlap.
   *
   * Not "today": renewing a fortnight late should not leave a fortnight
   * uncovered, and renewing early should not start cover before the customer
   * has finished paying for the period they are in.
   */
  /*
   * ...and ends a day short of the anniversary, like a new contract (amcPeriod)
   * and like the renewal dialog's preview. It used to end ON the anniversary:
   * the dialog showed 31 March and the contract said 1 April - a day of cover
   * nobody was quoted, and an overlap with the next renewal (9 Oct 2026).
   * India days, not the server's - see lib/expiry.
   */
  const startDate = addDays(startOfDay(old.endDate), 1);
  const endDate = addDays(addMonths(startDate, months), -1);

  const contractNo = await allocateDocumentNumber(storeId, 'AMC');

  return db.$transaction(async (tx) => {
    const created = await tx.amcContract.create({
      data: {
        storeId,
        contractNo,
        customerId: old.customerId,
        siteLabel: old.siteLabel,
        startDate,
        endDate,
        amountPaise: opts.amountPaise ?? old.amountPaise,
        // Active immediately: renewing IS the decision that it applies.
        status: 'active',
        coverageTerms: old.coverageTerms,
        visitsIncluded: old.visitsIncluded,
        reminderDays: old.reminderDays,
        // Copied, because renewing continues the same arrangement and the rate
        // was a person's decision about this customer. Both the renewal and
        // its invoice land as drafts, so a rate that changed since last year
        // is seen and corrected before anything is issued.
        taxRatePct: old.taxRatePct,
        sacCode: old.sacCode,
        renewedFromId: old.id,
        createdBy: opts.userId ?? null,
        items: {
          create: old.items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            qty: it.qty,
            serialNo: it.serialNo,
            srNo: it.srNo,
          })),
        },
      },
    });

    // The old one is spent, not cancelled - it ran its course.
    if (old.status === 'active') {
      await tx.amcContract.update({ where: { id: old.id }, data: { status: 'expired' } });
    }

    return created;
  });
}

/**
 * Mark active contracts whose end date has passed as expired.
 *
 * Status is stored rather than inferred on read so that it is a fact somebody
 * can see and override - a customer who pays late is still covered, and that
 * decision needs somewhere to live. The cost of storing it is that something
 * has to move it, which is this.
 *
 * Called from the AMC screen's own load rather than from a cron, because there
 * is no scheduler in this deployment and a status that only updates when
 * somebody looks is still correct whenever anybody looks. Cheap: one indexed
 * query on `(storeId, status)` filtered by date, updating only rows that are
 * genuinely past.
 */
export async function sweepExpiredAmcContracts(scope: StoreScope): Promise<number> {
  // Today in INDIA, not the server's UTC day - a contract ending today is
  // still live until midnight India time (9 Oct 2026, see lib/expiry).
  const today = startOfDay(new Date());

  const { count } = await db.amcContract.updateMany({
    where: { ...scopeWhere(scope), status: 'active', endDate: { lt: today } },
    data: { status: 'expired' },
  });
  return count;
}

/**
 * WHO PAYS for work on this customer's equipment.
 *
 * Gathers the three facts the pure rule needs - the customer's contracts, when
 * they last bought this product, and that product's warranty - and hands them
 * to `resolveCoverage`. All the judgement is in lib/amc-coverage; this is the
 * reading.
 *
 * `equipment` is for a SERIALISED unit, which knows its own sale date and
 * warranty (Phase 3). Without it the answer falls back to the most recent
 * sale of that product to that customer - the best available guess when all
 * we know is the product. Either way the same rule decides; there is only
 * one coverage path.
 */
export async function resolveCoverageFor(
  scope: StoreScope,
  input: {
    customerId: string;
    productId: string | null;
    onDate?: Date;
    equipment?: { soldOn: Date | null; warrantyMonths: number | null };
  },
): Promise<Coverage> {
  const { contracts, equipment, onDate } = await coverageInputs(scope, input);
  return resolveCoverage({ contracts, equipment, onDate });
}

/**
 * An installation was approved: slide the AMCs sold with that equipment to
 * start today (10 Oct 2026, decision 2 in SERVICE-REPAIR-FLOW-SPEC.md). Only
 * for a store whose warranty basis is "installation" - the same setting
 * decides both clocks - and only contracts still on their invoice date.
 */
export async function alignSaleAmcsToInstall(storeId: string, challanId: string): Promise<number> {
  const { alignToInstall } = await import('@/lib/amc-offer');
  const [store, challan] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: { warrantyStartsOn: true } }),
    db.installationChallan.findFirst({
      where: { id: challanId, storeId },
      select: { challanNo: true, completedAt: true, salesOrder: { select: { partyId: true } }, items: { select: { productId: true } } },
    }),
  ]);
  if (store?.warrantyStartsOn !== 'install' || !challan?.completedAt || !challan.salesOrder?.partyId) return 0;
  const productIds = challan.items.map((i) => i.productId).filter((x): x is string => !!x);
  if (!productIds.length) return 0;
  const contracts = await db.amcContract.findMany({
    where: {
      storeId, customerId: challan.salesOrder.partyId, status: 'active',
      originInvoiceItem: { productId: { in: productIds } },
    },
    select: { id: true, startDate: true, endDate: true, notes: true, originInvoice: { select: { invoiceDate: true } } },
  });
  let moved = 0;
  for (const c of contracts) {
    if (!c.originInvoice) continue;
    const p = alignToInstall({ startDate: c.startDate, endDate: c.endDate, invoiceDate: c.originInvoice.invoiceDate, installDate: challan.completedAt });
    if (!p) continue;
    const why = `Start moved to the installation date (${challan.challanNo}).`;
    await db.amcContract.update({ where: { id: c.id }, data: { startDate: p.startDate, endDate: p.endDate, notes: c.notes ? `${c.notes}
${why}` : why } });
    moved++;
  }
  return moved;
}

/**
 * The same reading, answered as two switches - technician (AMC) and part
 * (warranty, unless voided). See `resolveSplitCover` (10 Oct 2026).
 */
export async function resolveSplitCoverFor(
  scope: StoreScope,
  input: {
    customerId: string;
    productId: string | null;
    onDate?: Date;
    equipment?: { soldOn: Date | null; warrantyMonths: number | null };
    warrantyVoid?: { reason: string } | null;
  },
): Promise<SplitCover> {
  const { contracts, equipment, onDate } = await coverageInputs(scope, input);
  return resolveSplitCover({ contracts, equipment, onDate, warrantyVoid: input.warrantyVoid ?? null });
}

async function coverageInputs(
  scope: StoreScope,
  input: {
    customerId: string;
    productId: string | null;
    onDate?: Date;
    equipment?: { soldOn: Date | null; warrantyMonths: number | null };
  },
): Promise<{ contracts: CoverageContract[]; equipment: CoverageEquipment; onDate: Date }> {
  const onDate = input.onDate ?? new Date();
  const known = input.equipment;

  const [contracts, lastSale, product, store, install] = await Promise.all([
    db.amcContract.findMany({
      where: { ...scopeWhere(scope), customerId: input.customerId, status: 'active' },
      select: {
        id: true, contractNo: true, startDate: true, endDate: true, status: true, coverageTerms: true,
        items: { select: { productId: true } },
      },
    }),

    // The most recent ISSUED invoice line for this product to this customer.
    // Draft invoices are excluded: a warranty starts when goods are sold, and
    // a draft has not sold anything - it can still be edited or deleted.
    input.productId && !known
      ? db.invoiceItem.findFirst({
        where: {
          productId: input.productId,
          invoice: {
            ...scopeWhere(scope),
            partyId: input.customerId,
            lifecycle: { not: 'draft' },
          },
        },
        orderBy: { invoice: { invoiceDate: 'desc' } },
        select: { invoice: { select: { invoiceDate: true } } },
      })
      : Promise.resolve(null),

    input.productId && !known
      ? db.product.findFirst({
        where: { id: input.productId, ...scopeWhere(scope) },
        select: { warrantyMonths: true },
      })
      : Promise.resolve(null),

    // Where the warranty starts - the store's setting (Serial & Batch Stock →
    // Fields & settings). Read here as well since 10 Oct 2026: before that only
    // the serial screen honoured it and complaints always used the invoice date.
    scope.kind === 'all' ? Promise.resolve(null) : db.store.findUnique({ where: { id: scope.storeId }, select: { warrantyStartsOn: true } }),

    // The installation of this product for this customer, if one was approved.
    input.productId && !known
      ? db.installationChallan.findFirst({
        where: {
          ...scopeWhere(scope), completedAt: { not: null },
          salesOrder: { partyId: input.customerId },
          items: { some: { productId: input.productId } },
        },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      })
      : Promise.resolve(null),
  ]);
  const { warrantyStart } = await import('@/lib/stock-units');
  const soldOn = known
    ? known.soldOn
    : warrantyStart({
      basis: store?.warrantyStartsOn ?? 'invoice',
      invoiceDate: lastSale?.invoice.invoiceDate ?? null,
      installDate: install?.completedAt ?? null,
    });

  const asContracts: CoverageContract[] = contracts.map((c) => ({
    id: c.id,
    contractNo: c.contractNo,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    productIds: c.items.map((i) => i.productId).filter((x): x is string => x !== null),
    terms: c.coverageTerms,
  }));

  return {
    contracts: asContracts,
    equipment: {
      productId: input.productId,
      soldOn,
      warrantyMonths: known ? known.warrantyMonths : product?.warrantyMonths ?? null,
    },
    onDate,
  };
}

export interface CoverSummary {
  contractNo: string;
  endDate: Date;
  daysToExpiry: number;
  /** True when the cover is itemised, so it may not extend to what broke. */
  itemised: boolean;
}

/**
 * WHICH CUSTOMERS HOLD LIVE COVER, in one query.
 *
 * For list screens. The full `resolveCoverageFor` answers precisely - warranty
 * included, product matched - but it runs three queries per question, and a
 * complaints list holding 3,548 rows cannot ask it per row.
 *
 * So this is the cheap approximate answer a LIST needs: does this customer
 * have an active contract today. It deliberately does NOT claim the contract
 * covers the specific equipment - the badge that uses it says "has AMC", not
 * "this is covered", and the precise answer stays on the detail screen where
 * one query is affordable.
 *
 * Being honest about that difference matters: a list badge that overstated
 * cover would have staff quoting free repairs on equipment nobody insured.
 */
export async function customersWithCover(
  scope: StoreScope,
  onDate: Date = new Date(),
): Promise<Map<string, CoverSummary>> {
  const rows = await db.amcContract.findMany({
    where: {
      ...scopeWhere(scope),
      status: 'active',
      startDate: { lte: onDate },
      endDate: { gte: startOfDay(onDate) },
    },
    select: {
      customerId: true, contractNo: true, endDate: true,
      _count: { select: { items: true } },
    },
    orderBy: { endDate: 'desc' },
    take: LIST_MAX_ROWS,
  });

  const out = new Map<string, CoverSummary>();
  for (const r of rows) {
    // Ordered by endDate descending, so the first one seen for a customer is
    // their longest-running cover - the one worth naming.
    if (out.has(r.customerId)) continue;
    out.set(r.customerId, {
      contractNo: r.contractNo,
      endDate: r.endDate,
      daysToExpiry: daysBetween(onDate, r.endDate),
      itemised: r._count.items > 0,
    });
  }
  return out;
}

/** Contracts held by one customer, for the customer detail screen. */
export async function listAmcForCustomer(
  scope: StoreScope,
  customerId: string,
): Promise<AmcContractRow[]> {
  return listAmcContracts(scope, { customerId });
}

/* ---------------------------------------------------------------- from sales */

/**
 * Turn issued invoice lines carrying AMC into real contracts.
 *
 * ONE CONTRACT PER LINE. Eight identical cameras are one line with qty 8, so
 * they share one contract covering eight units; two different products are two
 * lines and two contracts. Per-physical-unit contracts need serialised stock
 * (Phase 3), and `AmcContractItem.serialNo` is already there waiting.
 *
 * IDEMPOTENT, AND THAT IS LOAD-BEARING.
 *
 * Guarded by the unique index on `AmcContract.originInvoiceItemId`, and it
 * queries for lines that have no contract rather than assuming. Issuing is one
 * step in a longer flow that can be retried, and this is also called as a
 * safety net when the AMC screen loads - so it must be safe to run a hundred
 * times. Creating a second contract for one sale would double a customer's
 * cover and double what they are billed.
 *
 * ONLY ISSUED INVOICES. A draft has sold nothing; it can still be edited or
 * deleted, and cover that begins before the invoice is real would be cover
 * nobody agreed to. Cancelled invoices are excluded for the same reason.
 *
 * Pass `invoiceId` to run it for one invoice, immediately after issuing it.
 * Omit it to sweep the whole scope for anything missed.
 */
export async function createContractsForInvoice(
  scope: StoreScope,
  opts: { invoiceId?: string; userId?: string } = {},
): Promise<{ created: number; contractNos: string[] }> {
  const lines = await db.invoiceItem.findMany({
    where: {
      amcOpted: true,
      // No contract yet. The relation is the guard, so a retry finds nothing
      // left to do rather than relying on catching a unique-constraint error.
      amcContract: { is: null },
      invoice: {
        ...scopeWhere(scope),
        ...(opts.invoiceId ? { id: opts.invoiceId } : {}),
        lifecycle: 'sent',
      },
    },
    select: {
      id: true, productId: true, productName: true, qty: true,
      amcMonths: true, amcPricePaise: true,
      invoice: {
        select: { id: true, storeId: true, partyId: true, invoiceDate: true, invoiceNo: true },
      },
    },
    take: LIST_MAX_ROWS,
  });

  // A line with no customer cannot become a contract - there is nobody to
  // cover. Counter sales to a walk-in have `partyId: null`, which is a valid
  // invoice and an impossible contract, so they are skipped rather than failed.
  const candidates = lines.filter((l) => l.invoice.partyId);

  if (candidates.length === 0) return { created: 0, contractNos: [] };

  /**
   * SECOND GUARD: does a contract already exist for this invoice and product.
   *
   * The line-id guard above is not enough on its own, because
   * `editIssuedInvoice` DELETES and recreates every line when an invoice is
   * corrected. The foreign key is `ON DELETE SET NULL`, so the old contract
   * survives with `originInvoiceItemId` blanked - and the recreated line then
   * looks brand new. Without this check, correcting a typo on an invoice would
   * silently give the customer a second contract and a second bill.
   *
   * Keyed on invoice + product rather than the line id for exactly that
   * reason: the product is what the cover is about, and it survives the line
   * being rewritten.
   */
  const existing = await db.amcContract.findMany({
    where: {
      ...scopeWhere(scope),
      originInvoiceId: { in: [...new Set(candidates.map((l) => l.invoice.id))] },
      status: { not: 'cancelled' },
    },
    select: { originInvoiceId: true, items: { select: { productId: true } } },
  });

  const alreadyCovered = new Set(
    existing.flatMap((c) => c.items.map((i) => `${c.originInvoiceId}|${i.productId ?? ''}`)),
  );

  const usable = candidates.filter(
    (l) => !alreadyCovered.has(`${l.invoice.id}|${l.productId ?? ''}`),
  );

  if (usable.length === 0) return { created: 0, contractNos: [] };

  const offers = await loadOffers(scope, usable.map((l) => l.productId));
  const contractNos: string[] = [];

  for (const line of usable) {
    const plan = planContractsForInvoice(
      [{
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        amcOpted: true,
        amcMonths: line.amcMonths,
        amcPricePaise: line.amcPricePaise,
      }],
      offers,
      line.invoice.invoiceDate,
    )[0];
    if (!plan) continue;

    /**
     * Numbers are allocated one at a time inside the loop, not in a batch
     * before it. `allocateDocumentNumber` is the single sequence service and
     * per-store concurrency is its problem, not this function's - reserving a
     * block here would be a second, worse implementation of it.
     */
    const contractNo = await allocateDocumentNumber(line.invoice.storeId, 'AMC');

    try {
      await db.amcContract.create({
        data: {
          storeId: line.invoice.storeId,
          contractNo,
          customerId: line.invoice.partyId!,
          startDate: plan.period.startDate,
          endDate: plan.period.endDate,
          amountPaise: plan.amountPaise,
          // Active immediately. The client's decision: an AMC sold on an
          // issued invoice covers the customer from that day, because
          // otherwise "included" is a promise nobody recorded and the
          // complaint screen would read Chargeable for a covered customer.
          status: 'active',
          coverageTerms: 'labour_only',
          coverageNote: plan.coverageNote,
          reminderDays: 30,
          originInvoiceId: line.invoice.id,
          originInvoiceItemId: line.id,
          createdBy: opts.userId ?? null,
          items: plan.productId
            ? {
              create: [{
                productId: plan.productId,
                productName: plan.productName,
                qty: plan.qty,
                srNo: 1,
              }],
            }
            : undefined,
        },
      });
      contractNos.push(contractNo);
    } catch (err) {
      // The unique index on originInvoiceItemId is the last line of defence
      // against two concurrent issues of the same invoice. Losing that race
      // means the contract exists, which is the desired end state - so it is
      // not an error worth failing the caller's invoice over.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  return { created: contractNos.length, contractNos };
}

/** The AMC offer for each of these products, keyed by id. */
async function loadOffers(
  scope: StoreScope,
  productIds: (string | null)[],
): Promise<Map<string, AmcOffer>> {
  const ids = productIds.filter((x): x is string => !!x);
  if (ids.length === 0) return new Map();

  const rows = await db.product.findMany({
    where: { id: { in: ids }, ...scopeWhere(scope) },
    select: {
      id: true, amcAvailable: true, amcPricingMode: true,
      amcDurationMonths: true, amcAnnualPricePaise: true, amcTerms: true,
    },
  });

  return new Map(rows.map((p) => [p.id, {
    amcAvailable: p.amcAvailable,
    amcPricingMode: p.amcPricingMode,
    amcDurationMonths: p.amcDurationMonths,
    amcAnnualPricePaise: p.amcAnnualPricePaise,
    amcTerms: p.amcTerms,
  }]));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && (err as { code?: string }).code === 'P2002';
}

/**
 * Raise the invoice that BILLS an AMC fee.
 *
 * A SEPARATE INVOICE, not a line on the product invoice - the client's
 * decision, 24 Sep 2026. So the goods invoice shows the goods and this one
 * shows the year of service, and each carries its own correct tax.
 *
 * CREATED AS A DRAFT, DELIBERATELY. Nothing here issues a tax document without
 * a person looking at it.
 *
 * THE RATE IS THE ONE ON THE CONTRACT, AND NOTHING ELSE. It was a hard-coded
 * 18, then briefly a store default; the client's instruction is that the GST
 * on an AMC is typed in by hand, so a contract with no rate is refused here
 * rather than billed at a number nobody chose. See lib/amc-tax. Wrong tax on an
 * issued invoice is a legal problem, not a bug (CLAUDE.md decision 4).
 *
 * `productId` is null on the line on purpose. `createDirectInvoice` moves stock
 * for every line that has one, so pointing this line at the covered product
 * would decrement the stock of a camera that never left the building. The link
 * to the product lives on the CONTRACT, which is the correct place for it.
 */
export async function raiseAmcInvoice(
  scope: StoreScope,
  contractId: string,
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  const c = await db.amcContract.findFirst({
    where: { id: contractId, storeId },
    include: {
      customer: {
        select: {
          id: true, title: true, firstName: true, lastName: true, companyName: true,
          email: true, phone: true, phoneCc: true, gstin: true,
          addressLine1: true, state: true, city: true, paymentTermsDays: true,
        },
      },
      items: { select: { productName: true, qty: true } },
      invoice: { select: { invoiceNo: true } },
    },
  });
  if (!c) throw new AmcError('That contract is not in your scope.');

  if (c.invoice) {
    throw new AmcError(`${c.contractNo} has already been invoiced as ${c.invoice.invoiceNo}.`);
  }
  if (c.amountPaise <= 0) {
    throw new AmcError(
      `${c.contractNo} has no fee to bill - its AMC was included in the purchase price.`,
    );
  }
  if (c.status === 'cancelled') {
    throw new AmcError('A cancelled contract cannot be invoiced.');
  }

  let taxRatePct: number;
  try {
    taxRatePct = requireAmcTaxRate(
      c.contractNo, c.taxRatePct !== null ? c.taxRatePct.toNumber() : null,
    );
  } catch (err) {
    throw new AmcError((err as Error).message);
  }
  const sacCode = c.sacCode?.trim() || null;

  const covers = c.items.length
    ? c.items.map((i) => `${i.productName}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ')
    : (c.siteLabel ?? 'whole site');
  const period = `${fmtDay(c.startDate)} to ${fmtDay(c.endDate)}`;

  const invoice = await createDirectInvoice(scope, {
    partyId: c.customerId,
    customerName: partyName(c.customer),
    organizationName: c.customer.companyName,
    email: c.customer.email,
    phone: `${c.customer.phoneCc} ${c.customer.phone}`,
    gstin: c.customer.gstin,
    billingAddress: c.customer.addressLine1,
    shippingAddress: c.customer.addressLine1,
    stateId: c.customer.state,
    cityId: c.customer.city,
    invoiceDate: new Date(),
    termsDays: c.customer.paymentTermsDays ?? 0,
    poNumber: null,
    deliveryCharge: 0,
    deliveryExempt: true,
    discountType: 'amount',
    discountValue: 0,
    termsBody: c.coverageNote,
    notes: `Annual maintenance contract ${c.contractNo}. Covers ${covers}. Period ${period}.`,
    lines: [{
      productId: null,
      productName: `AMC ${c.contractNo} - ${covers} (${period})`,
      productCode: null,
      qty: 1,
      unitPricePaise: c.amountPaise,
      discountPct: 0,
      taxRatePct,
      // A service line carries a SAC where a goods line carries an HSN. Null
      // when nobody entered one - an invented SAC is worse than a blank one,
      // because a blank one gets queried and a wrong one gets filed.
      hsnCode: sacCode,
    }],
  }, userId);

  await db.amcContract.update({
    where: { id: c.id },
    data: { invoiceId: invoice.id },
  });

  /**
   * The rate travels back with the invoice so the confirmation can name it.
   * Somebody has to be able to see it is wrong, and "a draft was created"
   * tells them nothing.
   */
  return { invoice, taxRatePct, sacCode };
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
