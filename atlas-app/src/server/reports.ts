import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { costsFor, getCostMethod } from './product-cost';
import type { CostMethod } from '@/lib/costing';
import { ACCOUNT, splitRevenue } from '@/lib/service-revenue';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The profit and loss statement.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * It is an indicative trading statement built from the documents this product
 * holds: invoices out, credit notes back, purchase bills in, plus the general
 * ledger for cost of goods sold. For a shop that wants to know whether last
 * month made money, that is the question.
 *
 * It is NOT a statutory profit and loss statement, and must never be presented
 * as one. Two reasons, both stated on the screen itself rather than buried:
 *
 *   1. IT ONLY KNOWS WHAT WAS ENTERED. Since 8 Oct 2026 the expense side is
 *      read from the general ledger, so salaries, staff claims, travel, petty
 *      cash, incentives, rent and bank charges are all in it - but only if
 *      somebody recorded them. An expense paid from a drawer and never
 *      entered is still invisible, and no report can fix that.
 *
 *   2. DEPRECIATION AND INCOME TAX ARE ABSENT ENTIRELY.
 *
 * Before 8 Oct 2026 the first reason was far worse than that: the expense
 * side summed purchase-bill lines and two parts accounts only, so a payroll
 * run posted to 5300 every month and never appeared here. A number labelled
 * "net" that quietly omits salaries is worse than no number, because somebody
 * will make a decision on it. Hence `indicative` in the type, and hence the
 * caveats travelling with the data rather than living in a comment nobody
 * reads.
 *
 * COGS itself is no longer estimated here - it is read straight off the
 * general ledger (net movement on `5010 Cost of Goods Sold` for the period),
 * the same figure `postCogsMovement` posts at the moment stock physically
 * leaves or returns (see `server/cogs.ts`). That is deliberately not the same
 * window as "invoices dated in this period" above it: an order dispatched on
 * the 30th and invoiced on the 1st carries its cost in the month it actually
 * left the shelf, not the month somebody got around to invoicing it. A
 * reversal (a cancelled dispatch, a cancelled return) lands in the period it
 * was reversed in, not restated into the original one - ordinary ledger
 * behaviour, not a bug.
 */

export interface PnLLine {
  label: string;
  amountPaise: number;
  /** Rendered as a subtraction. */
  negative?: boolean;
  hint?: string;
}

export interface ProfitAndLoss {
  from: Date;
  to: Date;
  costMethod: CostMethod;

  revenuePaise: number;
  /**
   * Revenue by stream (health check ACC-1): sales of goods, service & repair
   * income, AMC income. AMC is read off the ledger (4040), so a spread
   * contract counts only what has been earned in the period.
   */
  revenueLines: PnLLine[];
  creditNotesPaise: number;
  netRevenuePaise: number;

  cogsPaise: number;
  grossProfitPaise: number;
  grossMarginPct: number;

  expensesPaise: number;
  indicativeNetPaise: number;

  /** Output tax collected minus input tax paid. Positive means owed. */
  outputTaxPaise: number;
  inputTaxPaise: number;
  netGstPaise: number;

  invoiceCount: number;
  billCount: number;

  /**
   * Products sold in this period whose cost currently resolves to zero - a
   * live check against today's cost data, not a property of the posted GL
   * figure. `postCogsMovement` skips posting entirely for a movement whose
   * total is zero rather than posting a fake zero-value entry, so a nonzero
   * count here is the honest reason `cogsPaise` is under-stated: real stock
   * left, its cost just isn't in the system yet.
   */
  productsWithoutCost: number;

  expenseLines: PnLLine[];
}

/**
 * Everything sold in the window, and what it cost.
 *
 * Only `sent` invoices count. A draft is somebody typing and a cancelled
 * invoice is a document that was withdrawn - counting either as revenue is how
 * a month looks profitable until somebody checks.
 */
export async function profitAndLoss(
  scope: StoreScope,
  from: Date,
  to: Date,
): Promise<ProfitAndLoss> {
  const costMethod = await getCostMethod(scope);

  const [invoices, creditNotes, bills] = await Promise.all([
    db.invoice.findMany({
      where: {
        ...scopeWhere(scope),
        invoiceDate: { gte: from, lte: to },
        lifecycle: 'sent',
      },
      select: {
        id: true,
        taxableBasePaise: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true,
        items: { select: { productId: true, qty: true, lineTotalPaise: true } },
      },
      take: LIST_MAX_ROWS,
    }),

    // Credit notes reduce revenue. Goods came back, or an allowance was agreed;
    // either way the sale did not happen at the price the invoice said.
    db.creditNote.findMany({
      where: {
        ...scopeWhere(scope),
        lifecycle: 'issued',
        // `creditNoteDate`, not `createdAt`. The document's own date is what the
        // GST return is filed on, and it is the indexed column - a credit note
        // raised on the 1st for a sale in the previous month belongs to the
        // month it is dated, not the month somebody typed it.
        creditNoteDate: { gte: from, lte: to },
      },
      select: {
        taxableBasePaise: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true,
      },
      take: LIST_MAX_ROWS,
    }),

    db.purchaseBill.findMany({
      where: {
        ...scopeWhere(scope),
        billDate: { gte: from, lte: to },
        lifecycle: 'received',
      },
      select: {
        id: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true,
        items: {
          select: { productName: true, lineTotalPaise: true, movedStock: true },
        },
      },
      take: LIST_MAX_ROWS,
    }),
  ]);

  // ---- revenue ----------------------------------------------------------
  //
  // Taxable base, not grand total. GST collected is money held on behalf of the
  // government - counting it as revenue would inflate the top line by 18% and
  // every margin computed from it.
  // Streams (ACC-1). An AMC fee invoice is AMC income, taken from the ledger
  // below; every other invoice splits between goods and services by line.
  const amcInvoiceIds = new Set((await db.amcContract.findMany({
    where: { ...scopeWhere(scope), invoiceId: { in: invoices.map((i) => i.id) } },
    select: { invoiceId: true },
  })).map((c) => c.invoiceId));
  const soldIds = [...new Set(invoices.flatMap((i) => i.items.map((x) => x.productId)).filter((x): x is string => !!x))];
  const serviceIds = new Set((soldIds.length ? await db.product.findMany({
    where: { id: { in: soldIds }, kind: 'service', ...scopeWhere(scope) }, select: { id: true },
  }) : []).map((p) => p.id));
  let goodsPaise = 0;
  let servicePaise = 0;
  for (const inv of invoices) {
    if (amcInvoiceIds.has(inv.id)) continue;
    const split = splitRevenue(
      inv.items.map((x) => ({ account: x.productId && serviceIds.has(x.productId) ? ACCOUNT.serviceIncome : ACCOUNT.sales, weightPaise: x.lineTotalPaise })),
      inv.taxableBasePaise,
    );
    goodsPaise += split.get(ACCOUNT.sales) ?? 0;
    servicePaise += split.get(ACCOUNT.serviceIncome) ?? 0;
  }
  const amcLines = await db.journalLine.findMany({
    where: { account: { code: ACCOUNT.amcIncome }, journalEntry: { ...scopeWhere(scope), entryDate: { gte: from, lte: to } } },
    select: { debitPaise: true, creditPaise: true },
  });
  const amcPaise = amcLines.reduce((n, l) => n + l.creditPaise - l.debitPaise, 0);
  const revenueLines: PnLLine[] = [
    { label: 'Sales of goods', amountPaise: goodsPaise },
    { label: 'Service & repair income', amountPaise: servicePaise },
    { label: 'AMC income', amountPaise: amcPaise, hint: 'Earned in this period - fees for later months are held as AMC Received in Advance.' },
  ];
  const revenuePaise = goodsPaise + servicePaise + amcPaise;
  const creditNotesPaise = creditNotes.reduce((n, c) => n + c.taxableBasePaise, 0);
  const netRevenuePaise = revenuePaise - creditNotesPaise;

  // ---- cost of goods sold -------------------------------------------------
  //
  // Read off the ledger, not recomputed - net movement on 5010 for the
  // period. Debits (stock going out) increase it, credits (stock coming
  // back) reduce it; a reversal is just another line on the same account, so
  // a plain sum already nets it out correctly.
  const cogsLines = await db.journalLine.findMany({
    where: {
      account: { code: '5010' },
      journalEntry: { ...scopeWhere(scope), entryDate: { gte: from, lte: to } },
    },
    select: { debitPaise: true, creditPaise: true },
  });
  const cogsPaise = cogsLines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);

  // Still computed live, as a diagnostic only - this no longer feeds
  // `cogsPaise` above, it explains a gap in it. See the field's own comment.
  const soldQty = new Map<string, number>();
  for (const inv of invoices) {
    for (const item of inv.items) {
      if (!item.productId) continue;
      soldQty.set(item.productId, (soldQty.get(item.productId) ?? 0) + item.qty);
    }
  }
  const costs = await costsFor(scope, [...soldQty.keys()], costMethod);
  let productsWithoutCost = 0;
  for (const productId of soldQty.keys()) {
    if ((costs.get(productId)?.unitCostPaise ?? 0) === 0) productsWithoutCost += 1;
  }

  const grossProfitPaise = netRevenuePaise - cogsPaise;
  const grossMarginPct = netRevenuePaise > 0
    ? Math.round((grossProfitPaise / netRevenuePaise) * 1000) / 10
    : 0;

  // ---- expenses ----------------------------------------------------------
  //
  // EVERY EXPENSE ACCOUNT, FROM THE LEDGER (8 Oct 2026).
  //
  // Until today this section summed purchase-bill lines that did not move
  // stock, plus two parts accounts. Everything else a business actually
  // spends was missing: salaries (5300, posted by every payroll run since
  // payroll existed), staff claims, travel allowance and petty cash (5900,
  // 5800, 5850), sales incentives (5700), rent and electricity entered as
  // expense vouchers (5200) - all of them posted, all of them ignored here.
  // So this report's "net" and the dashboard's own GL profit tile disagreed
  // by exactly the amount of everything that matters, and the one on this
  // page was always the flattering number.
  //
  // Now it reads what `gl-summary.ts` reads, one line per account, so the two
  // screens can only differ by their period. Expense accounts are
  // debit-natured, so the figure is (debit - credit) and a refund reduces it;
  // taking the absolute value would make a refund look like spending.
  //
  // `5010 Cost of Goods Sold` is EXCLUDED here because it already has its own
  // line above - including it in both would subtract the cost of every sale
  // twice. Purchase-bill lines need no special handling any more: a non-stock
  // line posts to 5900 and arrives through the ledger like everything else,
  // and a line that moved stock posted to 1200 Inventory, which is not an
  // expense account at all and so cannot be counted here.
  const expenseAccounts = await db.account.findMany({
    where: { type: 'expense', code: { not: '5010' } },
    select: { id: true, code: true, name: true },
  });
  const expenseByAccount = expenseAccounts.length > 0
    ? await db.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: expenseAccounts.map((a) => a.id) },
        journalEntry: { ...scopeWhere(scope), entryDate: { gte: from, lte: to } },
      },
      _sum: { debitPaise: true, creditPaise: true },
    })
    : [];

  const accountById = new Map(expenseAccounts.map((a) => [a.id, a]));
  const expenseLines: PnLLine[] = expenseByAccount
    .map((g) => ({
      label: accountById.get(g.accountId)?.name ?? 'Expense',
      amountPaise: (g._sum.debitPaise ?? 0) - (g._sum.creditPaise ?? 0),
      negative: true,
    }))
    .filter((l) => l.amountPaise !== 0)
    .sort((a, b) => b.amountPaise - a.amountPaise);

  const expensesPaise = expenseLines.reduce((n, l) => n + l.amountPaise, 0);
  const indicativeNetPaise = grossProfitPaise - expensesPaise;

  // ---- GST ---------------------------------------------------------------
  //
  // Output tax is what was collected from customers; input tax is what was paid
  // to suppliers and is reclaimable. The difference is roughly what is owed.
  // Credit notes reduce output tax, which is the whole reason a credit note is
  // a statutory document rather than a note in the margin.
  const outputTaxPaise =
    invoices.reduce((n, i) => n + i.cgstPaise + i.sgstPaise + i.igstPaise, 0)
    - creditNotes.reduce((n, c) => n + c.cgstPaise + c.sgstPaise + c.igstPaise, 0);

  const inputTaxPaise = bills.reduce(
    (n, b) => n + b.cgstPaise + b.sgstPaise + b.igstPaise, 0,
  );

  return {
    from,
    to,
    costMethod,
    revenuePaise,
    revenueLines,
    creditNotesPaise,
    netRevenuePaise,
    cogsPaise,
    grossProfitPaise,
    grossMarginPct,
    expensesPaise,
    indicativeNetPaise,
    outputTaxPaise,
    inputTaxPaise,
    netGstPaise: outputTaxPaise - inputTaxPaise,
    invoiceCount: invoices.length,
    billCount: bills.length,
    productsWithoutCost,
    expenseLines,
  };
}
