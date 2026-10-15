import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { costsFor, getCostMethod } from './product-cost';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { valueStock } from '@/lib/costing';
import { CASH_METHODS, METHOD_LABEL } from '@/lib/receipt';
import {
  AGE_LABEL, ageBucket, monthEndsFor, owedAt, ratios, topParts,
  type AgeBucket, type DocAt, type Ratios, type SettlementAt,
} from '@/lib/balance-sheet';

/**
 * A statement of position: what the business owns, what it owes, what is left.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT.
 *
 * This is NOT a statutory balance sheet. Atlas records documents - invoices,
 * bills, receipts, payments - and this works the position out from them.
 *
 * WHY IT BALANCES, AND WHY THAT PROVES NOTHING
 *
 * A real balance sheet balances because two independently-kept sides happen to
 * agree, and the agreeing is the evidence. This one balances because equity is
 * DEFINED as assets minus liabilities - the accounting identity. It cannot
 * fail to balance, so the fact that it does tells you nothing about whether the
 * books are right. The screen says so in one line under the check row.
 *
 * WHAT IS DERIVED AND WHAT IS TYPED
 *
 *   Derived from documents - cannot be wrong unless the documents are:
 *     · Receivables      unpaid issued invoices
 *     · Payables         unpaid received purchase bills
 *     · Stock            quantity on hand × cost
 *     · GST payable      output tax less input tax
 *     · Cash movement    money received in, supplier payments out
 *     · Advances         receipts / payments not yet set against a document
 *
 *   Typed by a person (Settings › Opening balance), only as good as their care:
 *     · Opening cash and bank · Capital · Fixed assets · Loans
 *
 * EVERY FIGURE IS "AS AT" (area K, 11 Oct 2026)
 *
 * Receivables, payables and stock used to be today's figures whatever date was
 * asked for. They are now rolled back to the date (lib/balance-sheet.ts), which
 * is what lets the screen draw net worth month by month and compare with last
 * month without inventing anything. Stock at a past date is valued at TODAY'S
 * cost - Atlas does not keep a cost history per day - and the line says so.
 *
 * EVERY LINE CARRIES ITS WORKING
 *
 * `calc` is the sum that produced the figure, `madeOf` splits it into the parts
 * a person can open as a list, `from` names the documents behind it. All three
 * are built from the same rows as the figure - nothing here is a sub-line
 * invented for display.
 */

export interface CalcPart { label: string; paise: number }
export interface MadePart { label: string; paise: number; href?: string }

export interface BalanceLine {
  key: string;
  label: string;
  paise: number;
  /** Where the figure comes from: documents, typed in, or typed opening + documents. */
  basis: 'derived' | 'entered' | 'mixed';
  /** The working: these parts add up to `paise`. */
  calc: CalcPart[];
  /** What the figure is made of, each part a link to the list behind it. */
  madeOf: MadePart[];
  /** One line naming the records it comes from. */
  from: string;
  /** Screen that lists the records behind it. */
  route?: string;
}

export interface MonthPoint {
  label: string;
  asOf: string;
  /** Null for a month-end before the opening balances were true. */
  netWorthPaise: number | null;
}

export interface BalanceSheet {
  asOf: Date;
  /** Null when nobody has entered opening balances yet. */
  openingAsOf: Date | null;
  hasOpening: boolean;

  assets: BalanceLine[];
  liabilities: BalanceLine[];
  equity: BalanceLine[];

  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  totalEquityPaise: number;

  /** Assets − liabilities. What the business is worth on paper. */
  netWorthPaise: number;

  /** How much of net worth came from trading rather than from capital put in. */
  accumulatedResultPaise: number;

  /** The tiles. */
  kpi: Ratios & {
    currentAssetsPaise: number;
    currentLiabilitiesPaise: number;
    cashPaise: number;
    receivablePaise: number;
    overdue30Paise: number;
    outflow90Paise: number;
  };

  /** Net worth at the previous month-end, for "vs last month". */
  previous: { asOf: string; netWorthPaise: number | null };

  /** Net worth at each month-end of the financial year, then at `asOf`. */
  months: MonthPoint[];

  /** True when `asOf` is in the past and stock is valued at today's cost. */
  stockAtTodaysCost: boolean;
}

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const taxOf = (r: { cgstPaise: number; sgstPaise: number; igstPaise: number }) => r.cgstPaise + r.sgstPaise + r.igstPaise;
const t = (d: Date) => d.getTime();

/** Everything the statement is worked out from, loaded once for every date. */
interface Rows {
  invoices: (DocAt & { dueDate: Date; taxPaise: number })[];
  invoiceSettled: SettlementAt[];
  creditNotes: { date: Date; taxPaise: number }[];
  bills: (DocAt & { partyId: string; supplierName: string; taxPaise: number })[];
  billSettled: SettlementAt[];
  receipts: { id: string; at: Date; paise: number; method: string }[];
  /** Receipt → invoice, so an advance can be judged at a past date. */
  receiptApplied: { receiptId: string; invoiceId: string; paise: number }[];
  payments: { id: string; partyId: string; at: Date; paise: number; method: string }[];
  paymentApplied: { paymentId: string; billId: string; paise: number }[];
  stock: { id: string; categoryName: string | null; qty: number; unitCostPaise: number; costKnown: boolean }[];
  costMethod: string;
}

async function loadRows(scope: StoreScope, asOf: Date, earliest: Date): Promise<Rows> {
  const sw = scopeWhere(scope);
  const [
    invoices, recAlloc, cnAlloc, creditNotes, bills, payAlloc,
    receipts, receiptApplied, payments, paymentApplied, products, costMethod,
  ] = await Promise.all([
    db.invoice.findMany({
      where: { ...sw, lifecycle: 'sent', invoiceDate: { lte: asOf } },
      select: {
        id: true, invoiceDate: true, dueDate: true, grandTotalPaise: true, amountPaidPaise: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true,
      },
      take: LIST_MAX_ROWS,
    }),
    // Settlements after the earliest date asked about - the ones to roll back.
    db.receiptAllocation.findMany({
      where: { ...sw, receipt: { status: 'received', receivedAt: { gt: earliest } } },
      select: { invoiceId: true, amountPaise: true, receipt: { select: { receivedAt: true } } },
      take: LIST_MAX_ROWS,
    }),
    db.creditNoteAllocation.findMany({
      where: { ...sw, creditNote: { lifecycle: 'issued', creditNoteDate: { gt: earliest } } },
      select: { invoiceId: true, amountPaise: true, creditNote: { select: { creditNoteDate: true } } },
      take: LIST_MAX_ROWS,
    }),
    db.creditNote.findMany({
      where: { ...sw, lifecycle: 'issued', creditNoteDate: { lte: asOf } },
      select: { creditNoteDate: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
      take: LIST_MAX_ROWS,
    }),
    db.purchaseBill.findMany({
      where: { ...sw, lifecycle: 'received', billDate: { lte: asOf } },
      select: {
        id: true, partyId: true, supplierName: true, billDate: true,
        grandTotalPaise: true, amountPaidPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
      },
      take: LIST_MAX_ROWS,
    }),
    db.supplierPaymentAllocation.findMany({
      where: { ...sw, payment: { status: 'paid', paidAt: { gt: earliest } } },
      select: { billId: true, amountPaise: true, payment: { select: { paidAt: true } } },
      take: LIST_MAX_ROWS,
    }),
    db.receipt.findMany({
      where: { ...sw, status: 'received', receivedAt: { lte: asOf } },
      select: { id: true, receivedAt: true, amountPaise: true, method: true },
      take: LIST_MAX_ROWS,
    }),
    db.receiptAllocation.findMany({
      where: { ...sw, receipt: { status: 'received', receivedAt: { lte: asOf } } },
      select: { receiptId: true, invoiceId: true, amountPaise: true },
      take: LIST_MAX_ROWS,
    }),
    db.supplierPayment.findMany({
      where: { ...sw, status: 'paid', paidAt: { lte: asOf } },
      select: { id: true, partyId: true, paidAt: true, amountPaise: true, method: true },
      take: LIST_MAX_ROWS,
    }),
    db.supplierPaymentAllocation.findMany({
      where: { ...sw, payment: { status: 'paid', paidAt: { lte: asOf } } },
      select: { paymentId: true, billId: true, amountPaise: true },
      take: LIST_MAX_ROWS,
    }),
    db.product.findMany({
      where: { ...sw, isActive: true, kind: { not: 'service' } },
      select: { id: true, category: { select: { name: true } }, balances: { select: { currentQty: true } } },
      take: LIST_MAX_ROWS,
    }),
    getCostMethod(scope),
  ]);

  const costs = await costsFor(scope, products.map((p) => p.id), costMethod);

  return {
    invoices: invoices.map((i) => ({
      id: i.id, date: i.invoiceDate, dueDate: i.dueDate, totalPaise: i.grandTotalPaise,
      paidPaise: i.amountPaidPaise, taxPaise: taxOf(i),
    })),
    invoiceSettled: [
      ...recAlloc.map((a) => ({ docId: a.invoiceId, at: a.receipt.receivedAt, paise: a.amountPaise })),
      ...cnAlloc.map((a) => ({ docId: a.invoiceId, at: a.creditNote.creditNoteDate, paise: a.amountPaise })),
    ],
    creditNotes: creditNotes.map((c) => ({ date: c.creditNoteDate, taxPaise: taxOf(c) })),
    bills: bills.map((b) => ({
      id: b.id, partyId: b.partyId, supplierName: b.supplierName, date: b.billDate,
      totalPaise: b.grandTotalPaise, paidPaise: b.amountPaidPaise, taxPaise: taxOf(b),
    })),
    billSettled: payAlloc.map((a) => ({ docId: a.billId, at: a.payment.paidAt, paise: a.amountPaise })),
    receipts: receipts.map((r) => ({ id: r.id, at: r.receivedAt, paise: r.amountPaise, method: r.method })),
    receiptApplied: receiptApplied.map((a) => ({ receiptId: a.receiptId, invoiceId: a.invoiceId, paise: a.amountPaise })),
    payments: payments.map((p) => ({ id: p.id, partyId: p.partyId, at: p.paidAt, paise: p.amountPaise, method: p.method })),
    paymentApplied: paymentApplied.map((a) => ({ paymentId: a.paymentId, billId: a.billId, paise: a.amountPaise })),
    stock: products.map((p) => {
      const cost = costs.get(p.id);
      return {
        id: p.id,
        categoryName: p.category?.name ?? null,
        qty: p.balances.reduce((n, b) => n + b.currentQty, 0),
        unitCostPaise: cost?.unitCostPaise ?? 0,
        costKnown: (cost?.basis ?? 'none') !== 'none',
      };
    }),
    costMethod,
  };
}

/** Units that moved after `at`, per product - taken back to get stock at `at`. */
async function movedAfter(scope: StoreScope, at: Date): Promise<Map<string, number>> {
  const rows = await db.stockMovement.groupBy({
    by: ['productId'],
    where: { ...scopeWhere(scope), createdAt: { gt: at } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.qty ?? 0]));
}

type Opening = {
  asOfDate: Date; cashPaise: number; bankPaise: number;
  capitalPaise: number; fixedAssetsPaise: number; loansPaise: number;
} | null;

/**
 * The position at one instant. The main statement and every bar of the month
 * chart come through here, so the chart's last bar cannot disagree with the
 * statement under it.
 */
function positionAt(rows: Rows, opening: Opening, at: Date, moved: Map<string, number>) {
  // Cash movement is counted from the opening date, not from all time. Anything
  // before it is assumed to be inside the opening figure already - counting it
  // twice is the obvious way to get this wrong.
  const from = opening?.asOfDate ?? new Date(0);
  const inWindow = (d: Date) => t(d) >= t(from) && t(d) <= t(at);

  // ---- cash and bank ------------------------------------------------------
  // Only money that really moved (CASH_METHODS). A receipt marked "TDS
  // deducted" settles an invoice but the money went to the government, and an
  // "adjustment" moved no money at all - counting either as cash is how a cash
  // book stops reconciling with the bank.
  const cashSet = new Set<string>(CASH_METHODS);
  const inByMethod = new Map<string, { paise: number; n: number }>();
  let tdsPaise = 0; let tdsCount = 0;
  let adjustedPaise = 0;
  for (const r of rows.receipts) {
    if (!inWindow(r.at)) continue;
    if (cashSet.has(r.method)) {
      const m = inByMethod.get(r.method) ?? { paise: 0, n: 0 };
      m.paise += r.paise; m.n += 1;
      inByMethod.set(r.method, m);
    } else if (r.method === 'tds') { tdsPaise += r.paise; tdsCount += 1; } else adjustedPaise += r.paise;
  }
  const outByMethod = new Map<string, { paise: number; n: number }>();
  for (const p of rows.payments) {
    if (!inWindow(p.at)) continue;
    const m = outByMethod.get(p.method) ?? { paise: 0, n: 0 };
    m.paise += p.paise; m.n += 1;
    outByMethod.set(p.method, m);
  }
  const sum = (m: Map<string, { paise: number; n: number }>) => [...m.values()].reduce((a, b) => ({ paise: a.paise + b.paise, n: a.n + b.n }), { paise: 0, n: 0 });
  const cashIn = sum(inByMethod);
  const cashOut = sum(outByMethod);
  const openingCash = opening?.cashPaise ?? 0;
  const openingBank = opening?.bankPaise ?? 0;
  const cashPaise = openingCash + openingBank + cashIn.paise - cashOut.paise;

  // ---- owed by customers ------------------------------------------------------
  const owed = owedAt(rows.invoices, rows.invoiceSettled, at);
  const invoiceById = new Map(rows.invoices.map((i) => [i.id, i]));
  const aged: Record<AgeBucket, number> = { not_due: 0, d1_30: 0, d31_90: 0, d90_plus: 0 };
  let receivablePaise = 0;
  for (const [id, paise] of owed) {
    receivablePaise += paise;
    aged[ageBucket(invoiceById.get(id)!.dueDate, at)] += paise;
  }

  // ---- advances: money in or out that no document has used yet ---------------
  // A receipt counts against an invoice from the day it arrived (owedAt above),
  // so what it holds as an advance at `at` is its amount less what it settles on
  // invoices dated by then. Same for supplier payments.
  const appliedByReceipt = new Map<string, number>();
  for (const a of rows.receiptApplied) {
    const inv = invoiceById.get(a.invoiceId);
    if (!inv || t(inv.date) > t(at)) continue;
    appliedByReceipt.set(a.receiptId, (appliedByReceipt.get(a.receiptId) ?? 0) + a.paise);
  }
  let customerAdvancePaise = 0; let customerAdvanceCount = 0;
  for (const r of rows.receipts) {
    if (t(r.at) > t(at)) continue;
    const left = r.paise - (appliedByReceipt.get(r.id) ?? 0);
    if (left > 0) { customerAdvancePaise += left; customerAdvanceCount += 1; }
  }
  const billById = new Map(rows.bills.map((b) => [b.id, b]));
  const appliedByPayment = new Map<string, number>();
  for (const a of rows.paymentApplied) {
    const bill = billById.get(a.billId);
    if (!bill || t(bill.date) > t(at)) continue;
    appliedByPayment.set(a.paymentId, (appliedByPayment.get(a.paymentId) ?? 0) + a.paise);
  }
  let supplierAdvancePaise = 0; let supplierAdvanceCount = 0;
  for (const p of rows.payments) {
    if (t(p.at) > t(at)) continue;
    const left = p.paise - (appliedByPayment.get(p.id) ?? 0);
    if (left > 0) { supplierAdvancePaise += left; supplierAdvanceCount += 1; }
  }

  // ---- owed to suppliers --------------------------------------------------------
  const billOwed = owedAt(rows.bills, rows.billSettled, at);
  const bySupplier = new Map<string, { label: string; paise: number; href: string }>();
  let payablePaise = 0;
  for (const [id, paise] of billOwed) {
    const b = billById.get(id)!;
    payablePaise += paise;
    const s = bySupplier.get(b.partyId) ?? { label: b.supplierName, paise: 0, href: `/suppliers/${b.partyId}` };
    s.paise += paise;
    bySupplier.set(b.partyId, s);
  }

  // ---- stock -----------------------------------------------------------------
  const lines = rows.stock.map((s) => ({ ...s, qty: s.qty - (moved.get(s.id) ?? 0) }));
  const stock = valueStock(lines);
  const byCategory = new Map<string, number>();
  for (const l of lines) {
    if (!l.costKnown || l.unitCostPaise <= 0) continue;
    const k = l.categoryName ?? 'No category';
    byCategory.set(k, (byCategory.get(k) ?? 0) + l.qty * l.unitCostPaise);
  }

  // ---- GST -----------------------------------------------------------------------
  // GST collected but not yet handed over is money held on someone else's behalf
  // - a liability. Negative means the government owes you; it is shown as nil,
  // and the working says so.
  const outputTax = rows.invoices.filter((i) => inWindow(i.date)).reduce((n, i) => n + i.taxPaise, 0);
  const cnTax = rows.creditNotes.filter((c) => inWindow(c.date)).reduce((n, c) => n + c.taxPaise, 0);
  const inputTax = rows.bills.filter((b) => inWindow(b.date)).reduce((n, b) => n + b.taxPaise, 0);
  const netGst = outputTax - cnTax - inputTax;
  const gstPayable = Math.max(0, netGst);

  const fixed = opening?.fixedAssetsPaise ?? 0;
  const loans = opening?.loansPaise ?? 0;
  const capital = opening?.capitalPaise ?? 0;

  const currentAssets = cashPaise + receivablePaise + stock.valuePaise + supplierAdvancePaise + tdsPaise;
  const currentLiabilities = payablePaise + gstPayable + customerAdvancePaise;
  const totalAssets = currentAssets + fixed;
  const totalLiabilities = currentLiabilities + loans;
  const netWorth = totalAssets - totalLiabilities;

  return {
    from, cashPaise, openingCash, openingBank, cashIn, cashOut, inByMethod, outByMethod,
    tdsPaise, tdsCount, adjustedPaise,
    receivablePaise, receivableCount: owed.size, aged,
    customerAdvancePaise, customerAdvanceCount, supplierAdvancePaise, supplierAdvanceCount,
    payablePaise, payableCount: billOwed.size, bySupplier,
    stock, byCategory,
    outputTax, cnTax, inputTax, netGst, gstPayable,
    fixed, loans, capital,
    currentAssets, currentLiabilities, totalAssets, totalLiabilities, netWorth,
  };
}

export async function balanceSheet(
  scope: StoreScope,
  asOf = new Date(),
): Promise<BalanceSheet> {
  const opening = await db.openingBalance.findFirst({
    where: { ...scopeWhere(scope) },
    select: {
      asOfDate: true, cashPaise: true, bankPaise: true,
      capitalPaise: true, fixedAssetsPaise: true, loansPaise: true,
    },
  });

  const now = new Date();
  // "Today" arrives as the moment the page asked, a few ms before this line.
  const isPast = t(asOf) < t(now) - 60_000;
  const { points, previous } = monthEndsFor(asOf);
  // A month-end before the opening balances were true has no honest position:
  // the opening cash did not exist yet. Those bars are left empty.
  const usable = (d: Date) => !opening || t(d) >= t(opening.asOfDate);
  const dates = [...points.map((p) => p.at), previous].filter(usable);
  const earliest = new Date(Math.min(t(asOf), ...dates.map(t)));

  const rows = await loadRows(scope, asOf, earliest);
  // Stock movements after each date, to take stock back to it. Nothing to take
  // back for a date that is now or later.
  const uniq = [...new Set([...dates, asOf].map(t))];
  const movedList = await Promise.all(
    uniq.map((ms) => (ms >= t(now) ? Promise.resolve(new Map<string, number>()) : movedAfter(scope, new Date(ms)))),
  );
  const movedAt = new Map(uniq.map((ms, i) => [ms, movedList[i]]));
  const at = (d: Date) => positionAt(rows, opening, d, movedAt.get(t(d)) ?? new Map());

  const p = at(asOf);
  const prev = usable(previous) ? at(previous).netWorth : null;
  const months: MonthPoint[] = points.map((m) => ({
    label: m.label,
    asOf: m.at.toISOString(),
    netWorthPaise: usable(m.at) ? (t(m.at) === t(asOf) ? p.netWorth : at(m.at).netWorth) : null,
  }));

  const outflow90 = rows.payments
    .filter((x) => t(x.at) > t(asOf) - 90 * 86_400_000 && t(x.at) <= t(asOf))
    .reduce((n, x) => n + x.paise, 0);

  const openingNote = opening ? `typed in for ${fmtDay(opening.asOfDate)}` : 'not entered yet';
  const sinceWord = opening ? `since ${fmtDay(opening.asOfDate)}` : 'since records began';
  const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

  // ---- the lines ----------------------------------------------------------------
  const cashMade: MadePart[] = [];
  if (opening) {
    cashMade.push({ label: 'Opening cash in hand (typed in)', paise: p.openingCash, href: '/settings/opening-balance' });
    cashMade.push({ label: 'Opening bank (typed in)', paise: p.openingBank, href: '/settings/opening-balance' });
  }
  for (const m of new Set([...p.inByMethod.keys(), ...p.outByMethod.keys()])) {
    const net = (p.inByMethod.get(m)?.paise ?? 0) - (p.outByMethod.get(m)?.paise ?? 0);
    if (net !== 0) cashMade.push({ label: `${methodLabel(m)} - in less out`, paise: net, href: '/receipts' });
  }

  const cashCalc: CalcPart[] = [
    { label: `Opening cash and bank (${openingNote})`, paise: p.openingCash + p.openingBank },
    { label: `+ Received from customers (${plural(p.cashIn.n, 'receipt')})`, paise: p.cashIn.paise },
    { label: `− Paid to suppliers (${plural(p.cashOut.n, 'payment')})`, paise: -p.cashOut.paise },
  ];

  const assets: BalanceLine[] = [
    {
      key: 'cash', label: 'Cash and bank', paise: p.cashPaise, basis: opening ? 'mixed' : 'derived',
      calc: cashCalc,
      madeOf: cashMade,
      from: `Opening balance plus receipts (cash, UPI, bank, cheque, card) less supplier payments ${sinceWord}. `
        + 'Atlas records how money came in, not which bank account it landed in, so this is one figure. '
        + 'Expenses, salaries and petty cash paid out are not taken off yet.'
        + (p.adjustedPaise > 0 ? ` ${rupees(p.adjustedPaise)} settled by adjustment moved no money and is not counted.` : ''),
      route: '/receipts',
    },
    {
      key: 'recv', label: 'Owed by customers', paise: p.receivablePaise, basis: 'derived',
      calc: [{ label: `Unpaid on ${plural(p.receivableCount, 'invoice')}`, paise: p.receivablePaise }],
      madeOf: (Object.keys(AGE_LABEL) as AgeBucket[]).filter((k) => p.aged[k] !== 0).map((k) => ({
        label: AGE_LABEL[k], paise: p.aged[k], href: k === 'not_due' ? '/invoices' : '/invoices?card=overdue',
      })),
      from: 'Every issued invoice less the receipts and credit notes set against it by this date.',
      route: '/invoices',
    },
    {
      key: 'stock', label: 'Stock on hand', paise: p.stock.valuePaise, basis: 'derived',
      calc: [
        { label: `${p.stock.unitsValued.toLocaleString('en-IN')} units × cost (${rows.costMethod.replace(/_/g, ' ')})`, paise: p.stock.valuePaise },
        ...(p.stock.productsUnvalued > 0
          ? [{ label: `${plural(p.stock.productsUnvalued, 'product')} with no cost - not valued`, paise: 0 }]
          : []),
      ],
      madeOf: topParts([...p.byCategory].map(([label, paise]) => ({ label, paise, href: '/reports/product-stock' })), 5, 'Other categories')
        .map((x) => ({ href: '/reports/product-stock', ...x })),
      from: 'Stock ledger quantities × purchase cost (Settings › System › costing method).'
        + (isPast ? ' For a past date, quantities are taken back to that day and valued at today\'s cost.' : ''),
      route: '/reports/product-stock',
    },
  ];
  if (p.supplierAdvancePaise > 0) {
    assets.push({
      key: 'supadv', label: 'Paid to suppliers in advance', paise: p.supplierAdvancePaise, basis: 'derived',
      calc: [{ label: `${plural(p.supplierAdvanceCount, 'payment')} not yet set against a bill`, paise: p.supplierAdvancePaise }],
      madeOf: [],
      from: 'Supplier payments less what has been set against their bills by this date.',
      route: '/purchase/payments',
    });
  }
  if (p.tdsPaise > 0) {
    assets.push({
      key: 'tds', label: 'TDS deducted by customers', paise: p.tdsPaise, basis: 'derived',
      calc: [{ label: `${plural(p.tdsCount, 'receipt')} marked "TDS deducted" ${sinceWord}`, paise: p.tdsPaise }],
      madeOf: [],
      from: 'Receipts recorded as TDS: the customer paid this to the government for you - claim it against your tax.',
      route: '/receipts',
    });
  }
  assets.push({
    key: 'fixed', label: 'Fixed assets', paise: p.fixed, basis: 'entered',
    calc: [{ label: `Written-down value (${openingNote})`, paise: p.fixed }],
    madeOf: [],
    from: 'Opening balances - one figure, no depreciation is calculated.',
    route: '/settings/opening-balance',
  });

  const liabilities: BalanceLine[] = [
    {
      key: 'pay', label: 'Owed to suppliers', paise: p.payablePaise, basis: 'derived',
      calc: [{ label: `Unpaid on ${plural(p.payableCount, 'purchase bill')}`, paise: p.payablePaise }],
      madeOf: topParts([...p.bySupplier.values()], 5, 'Other suppliers').map((x) => ({ href: '/purchase/payables', ...x })),
      from: 'Received purchase bills less the supplier payments set against them by this date.',
      route: '/purchase/payables',
    },
    {
      key: 'gst', label: 'GST payable', paise: p.gstPayable, basis: 'derived',
      calc: [
        { label: 'GST on sales invoices', paise: p.outputTax },
        { label: '− GST reversed by credit notes', paise: -p.cnTax },
        { label: '− GST paid on purchase bills', paise: -p.inputTax },
        ...(p.netGst < 0 ? [{ label: 'The government owes you this - shown as nil', paise: -p.netGst }] : []),
      ],
      madeOf: [],
      from: `Invoices, credit notes and purchase bills dated ${sinceWord}. GST already paid to the government is not recorded in Atlas.`,
      route: '/reports/gst',
    },
  ];
  if (p.customerAdvancePaise > 0) {
    liabilities.push({
      key: 'custadv', label: 'Advances from customers', paise: p.customerAdvancePaise, basis: 'derived',
      calc: [{ label: `${plural(p.customerAdvanceCount, 'receipt')} not yet set against an invoice`, paise: p.customerAdvancePaise }],
      madeOf: [],
      from: 'Money received that no invoice has used yet - owed back as goods, work or a refund.',
      route: '/receipts?f=unapplied',
    });
  }
  liabilities.push({
    key: 'loan', label: 'Loans outstanding', paise: p.loans, basis: 'entered',
    calc: [{ label: `Typed in (${openingNote})`, paise: p.loans }],
    madeOf: [],
    from: 'Opening balances - borrowings that have to be repaid.',
    route: '/settings/opening-balance',
  });

  const accumulated = p.netWorth - p.capital;
  const equity: BalanceLine[] = [
    {
      key: 'cap', label: 'Capital introduced', paise: p.capital, basis: 'entered',
      calc: [{ label: `Typed in (${openingNote})`, paise: p.capital }],
      madeOf: [],
      from: 'Opening balances - what the owner put in.',
      route: '/settings/opening-balance',
    },
    {
      key: 'ret', label: 'Accumulated result', paise: accumulated, basis: 'derived',
      calc: [
        { label: 'What you own less what you owe (net worth)', paise: p.netWorth },
        { label: '− Capital introduced', paise: -p.capital },
      ],
      madeOf: [],
      // The residual. Not computed from anything - it is whatever is left once
      // capital is taken out of net worth, which is exactly what "what the
      // business has built up by trading" means.
      from: accumulated >= 0
        ? 'Whatever is left once capital is taken out - what trading has built up. It is the balancing figure, not a separate sum.'
        : 'Whatever is left once capital is taken out. Negative: the business has used more than it has earned, or the opening figures are incomplete.',
      route: '/reports/profit-loss',
    },
  ];

  return {
    asOf,
    openingAsOf: opening?.asOfDate ?? null,
    hasOpening: opening != null,
    assets,
    liabilities,
    equity,
    totalAssetsPaise: p.totalAssets,
    totalLiabilitiesPaise: p.totalLiabilities,
    totalEquityPaise: p.capital + accumulated,
    netWorthPaise: p.netWorth,
    accumulatedResultPaise: accumulated,
    kpi: {
      ...ratios({
        currentAssetsPaise: p.currentAssets,
        currentLiabilitiesPaise: p.currentLiabilities,
        loansPaise: p.loans,
        netWorthPaise: p.netWorth,
        cashPaise: p.cashPaise,
        outflow90Paise: outflow90,
      }),
      currentAssetsPaise: p.currentAssets,
      currentLiabilitiesPaise: p.currentLiabilities,
      cashPaise: p.cashPaise,
      receivablePaise: p.receivablePaise,
      overdue30Paise: p.aged.d31_90 + p.aged.d90_plus,
      outflow90Paise: outflow90,
    },
    previous: { asOf: previous.toISOString(), netWorthPaise: prev },
    months,
    stockAtTodaysCost: isPast,
  };
}

// ------------------------------------------------------------------ settings

export async function getOpeningBalance(scope: StoreScope) {
  return db.openingBalance.findFirst({ where: { ...scopeWhere(scope) } });
}

export async function saveOpeningBalance(
  scope: StoreScope,
  storeId: string,
  input: {
    asOfDate: Date;
    cashPaise: number;
    bankPaise: number;
    capitalPaise: number;
    fixedAssetsPaise: number;
    loansPaise: number;
    note?: string | null;
  },
  userId: string,
): Promise<void> {
  await postOpeningBalanceJournal(scope, storeId, input, userId);

  await db.openingBalance.upsert({
    where: { storeId },
    create: { storeId, ...input, note: input.note ?? null, updatedBy: userId },
    update: { ...input, note: input.note ?? null, updatedBy: userId },
  });
}

/**
 * The opening balance's journal entry - one per store, superseded rather than
 * duplicated. There is exactly one `OpeningBalance` row per store (it's an
 * upsert above), so re-entering these figures means the old ones were wrong,
 * not that a second opening event happened: any prior entry is reversed
 * first, then the new figures post fresh.
 *
 * Five independent numbers typed by a person are not required to balance on
 * their own - whatever gap is left plugs against `3900 Opening Balance
 * Equity`, the honest label for "assets or capital nobody could trace to the
 * other side."
 */
async function postOpeningBalanceJournal(
  scope: StoreScope,
  storeId: string,
  input: {
    asOfDate: Date;
    cashPaise: number;
    bankPaise: number;
    capitalPaise: number;
    fixedAssetsPaise: number;
    loansPaise: number;
  },
  userId: string,
): Promise<void> {
  const existing = await db.journalEntry.findFirst({
    where: { storeId, sourceType: 'opening_balance', reversalOfId: null },
    select: { id: true },
  });
  if (existing) {
    await reverseJournalEntry(scope, existing.id, userId, 'Opening balance re-entered');
  }

  const lines: LedgerLineInput[] = [];
  if (input.cashPaise > 0) lines.push({ accountCode: '1010', debitPaise: input.cashPaise });
  if (input.bankPaise > 0) lines.push({ accountCode: '1020', debitPaise: input.bankPaise });
  if (input.fixedAssetsPaise > 0) lines.push({ accountCode: '1500', debitPaise: input.fixedAssetsPaise });
  if (input.loansPaise > 0) lines.push({ accountCode: '2400', creditPaise: input.loansPaise });
  if (input.capitalPaise > 0) lines.push({ accountCode: '3010', creditPaise: input.capitalPaise });

  const debits = input.cashPaise + input.bankPaise + input.fixedAssetsPaise;
  const credits = input.loansPaise + input.capitalPaise;
  const diff = debits - credits;
  if (diff > 0) lines.push({ accountCode: '3900', creditPaise: diff });
  if (diff < 0) lines.push({ accountCode: '3900', debitPaise: -diff });

  // All five figures were zero - nothing to post, and nothing to reverse
  // beyond what already happened above.
  if (lines.length === 0) return;

  await postJournalEntry(scope, {
    entryDate: input.asOfDate,
    description: `Opening balance as at ${input.asOfDate.toISOString().slice(0, 10)}`,
    sourceType: 'opening_balance',
    sourceId: storeId,
    lines,
  }, userId);
}
