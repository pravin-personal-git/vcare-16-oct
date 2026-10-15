import 'server-only';
import { isExpired, type QuotationStatus } from '@/lib/quotation-totals';
import { db } from './db';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import { computeBalances } from './parties';
import { supplierBalances } from './purchases';
import { stockValuation } from './product-cost';
import { profitAndLoss } from './reports';
import { financialYearRange, getFinancialYear } from '@/lib/financial-year';
import { glSummary } from './gl-summary';
import { listUserAccounts } from './staff-accounts';
import { listIncentives } from './incentives';
import { getIncentiveRule } from './incentive-settings';
import { BASIS_LABEL, DEFAULT_RULE, EARNED_ON_LABEL } from '@/lib/incentive-rules';
// Aliased because a local `const outstandingPaise` shadowed it, which is how
// this file ended up with a second way of working out the same figure.
import {
  invoiceStatus, outstandingPaise as outstandingOf, type InvoiceLifecycle,
} from '@/lib/invoice-status';
import { countsAsRevenue } from '@/lib/revenue';
import { listNotices } from './notices';
import { taskPipelineCounts } from './tasks';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
// The RULES, not server/amc.ts - see the note on `amcAttention` for why the
// dashboard deliberately does not pull that module in.
import { expiryState, startOfDay } from '@/lib/expiry';
import { billingState } from '@/lib/amc-offer';

/** The India calendar month (0-11) of an instant - an order at 00:30 IST on 1 April is April. */
const istMonth = (d: Date) => new Date(d.getTime() + 330 * 60_000).getUTCMonth();

/**
 * Dashboard aggregates.
 *
 * Every figure here is a real store-scoped query. Where a module does not exist
 * yet the field is present and zero, and the screen labels it as not built -
 * an invented number on a dashboard is worse than a gap, because people act on
 * dashboards.
 *
 * Spec: 01-dashboards.md
 */

export interface DashboardData {
  financial: {
    outstandingPaise: number;
    customerCount: number;
    staffBalancePaise: number;
    saleFyPaise: number;
    orderCount: number;
    stockValuePaise: number;
    supplierCount: number;
    profitPaise: number;
    /** True when the figure came from GL postings rather than the indicative sum. */
    profitFromLedger: boolean;
    invoiceDuePaise: number;
    expensesPaise: number;
    payablePaise: number;
  };
  attendance: { present: number; late: number; unmarked: number; absent: number };
  monthly: { label: string; salePaise: number; purchasePaise: number; expensePaise: number }[];
  customers: {
    oneTime: number; repeat: number;
    byType: { label: string; count: number }[];
    total: number;
  };
  approvals: {
    salesOrder: number; customerPayment: number; expense: number;
    purchaseOrder: number; supplierPayment: number; leave: number;
  };
  stock: { lowStock: number; outOfStock: number; timeForPo: number; nonMoving: number };
  pipeline: {
    tasks: { total: number; pending: number; inProgress: number; overdue: number; dueToday: number };
    services: { total: number; newLead: number; pending: number; completed: number; invoiced: number };
    leads: { total: number; contacted: number; inProgress: number; closed: number; won: number; lost: number };
  };
  topCategories: { label: string; count: number }[];
  accounts: { due: number; overDue: number; dueToday: number; crossedLimit: number };
  salespersonBalances: { name: string; paise: number }[];
  recent: { id: string; type: string; description: string; amount: number | null; at: Date }[];
  notices: { id: string; title: string; pinned: boolean }[];

  /**
   * MAINTENANCE CONTRACTS THAT NEED SOMETHING DOING.
   *
   * On the dashboard because a renewal reminder that only appears on the AMC
   * screen is not a reminder - it depends on somebody choosing to go and look,
   * which is exactly the habit that loses the renewal. This is the recurring
   * revenue the business already earned once and has to ask for again.
   *
   * Three separate numbers because they need three different actions: chase a
   * renewal, chase a lapse, or raise an invoice for money already agreed.
   */
  amc: {
    /** Active, inside the reminder window, not yet expired - call them. */
    dueForRenewal: number;
    /** Active but past the end date - cover nobody renewed. */
    lapsed: number;
    /** A fee agreed and never invoiced. Money left on the table. */
    awaitingInvoice: number;
    awaitingInvoicePaise: number;
    /** Annual value of everything currently live. */
    activeValuePaise: number;
    /** The soonest few to expire, so the tile can name them. */
    soonest: { id: string; contractNo: string; customerName: string; daysToExpiry: number }[];
  };
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

export async function getDashboard(scope: StoreScope, now = new Date()): Promise<DashboardData> {
  const where = scopeWhere(scope);
  const fy = getFinancialYear(now);
  // `getFinancialYear` returns the STARTING year - 2026 means April 2026 to
  // March 2027. This was hand-rolled here with the year off by one, so the
  // "Sale FY" tile was reporting the wrong financial year entirely. One shared
  // implementation now, so it cannot drift again.
  const { start: fyStart, end: fyEnd } = financialYearRange(fy);

  // Today in INDIA (9 Oct 2026) - the server's midnight is 05:30 IST on Vercel.
  const startOfToday = startOfDay(now);

  /**
   * One batch, not eight awaits.
   *
   * `Promise.all` looks concurrent but a single pooled connection serialises
   * it, so eight queries cost eight round trips. To a database in another
   * region that was most of the page's load time. `$transaction` with an array
   * sends them together and costs one.
   */
  const [
    parties, products, balances, orders, ordersFy, leads, activity, users, openInvoices,
  ] = await db.$transaction([
    db.party.findMany({
      where,
      select: {
        // currentBalancePaise deliberately NOT selected - it is the stale
        // hand-maintained column. Everything here uses balanceOf().
        id: true, isCustomer: true, isSupplier: true,
        payablePaise: true, creditLimitPaise: true, creditLimitDays: true,
        dueDate: true, customerType: { select: { name: true } },
        assignedManagerId: true, lastPurchaseAt: true,
      },
    }),
    db.product.findMany({
      where: { ...where, isActive: true },
      select: { id: true, categoryId: true, category: { select: { name: true } } },
    }),
    db.productBalance.findMany({
      where: { product: { ...where, isActive: true } },
      select: {
        currentQty: true, reorderLevel: true, lastSoldAt: true,
        product: { select: { prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } } } },
      },
    }),
    db.salesOrder.findMany({
      where,
      select: {
        id: true, grandTotalPaise: true, amountPaidPaise: true,
        fulfilmentStatus: true, orderDate: true,
      },
    }),
    db.salesOrder.aggregate({
      where: { ...where, orderDate: { gte: fyStart, lte: fyEnd } },
      _sum: { grandTotalPaise: true },
      _count: true,
    }),
    db.lead.findMany({
      where,
      select: {
        isClosed: true, convertedCustomerId: true,
        stage: { select: { name: true } },
      },
    }),
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, activityType: true, entityType: true, description: true, amount: true, createdAt: true },
    }),
    /**
     * Scoped, though it is only ever used as an id -> name lookup for this
     * tenant's own rows. Unscoped it read every user in the database on each
     * dashboard render: no name from another tenant could surface, because
     * only local ids are looked up, but there is no reason to load them and
     * an unscoped `user` query is the shape that becomes a leak the moment
     * somebody renders the map instead of indexing it. Tightened 23 Sep 2026
     * alongside the real leak in `complaints.ts::listTechnicians`.
     */
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
    // Receivable is read from the invoices, not summed from customer balances.
    // See the note on `outstandingPaise` below for why that matters.
    db.invoice.findMany({
      where,
      select: { lifecycle: true, grandTotalPaise: true, amountPaidPaise: true },
    }),
  ]);

  // ---- financial -----------------------------------------------------------
  const customers = parties.filter((p) => p.isCustomer);
  const suppliers = parties.filter((p) => p.isSupplier);

  /**
   * Derived, exactly as the Customers screen derives it.
   *
   * This read Party.currentBalancePaise, which is the hand-maintained column
   * that had drifted to minus the total ever paid. The Customers screen was
   * fixed to derive; the dashboard was not, so it went on reporting nothing
   * outstanding while the screen one click away said 33,482.
   *
   * Fixing one of two readers of a bad column is not fixing it. Both now call
   * the same function.
   */
  const owed = await computeBalances(scope, customers.map((c) => c.id));
  const balanceOf = (id: string) => owed.get(id) ?? 0;

  /**
   * Receivable, read from the invoices themselves.
   *
   * This used to sum each customer's balance instead, which is a different
   * measure wearing the same label, and it disagreed with the Invoices screen
   * in two ways:
   *
   *  - An invoice with no customer record - a walk-in sale - belongs to nobody,
   *    so it was summed over nothing and vanished. It is still money owed.
   *  - A customer holding an advance nets it against their own unpaid invoices.
   *    Money received in advance is not a reduction of what is receivable; it
   *    is a separate obligation, and folding it in understates the debt.
   *
   * Both screens now call the same function, which is also what the Sales tab
   * of this same dashboard was already doing. Three derivations of one number
   * lived in this file; there is now one.
   *
   * `balanceOf` stays - per-customer balances are the right measure for credit
   * limits and the top-customer list, and those are genuinely per customer.
   */
  const outstandingPaise = outstandingOf(openInvoices);

  /**
   * PAYABLES AND STOCK VALUE COME FROM THE SAME PLACE THE DEDICATED SCREENS USE.
   *
   * Both were wrong until 9 Sep 2026, and both were wrong quietly:
   *
   *   PAYABLES read `Party.payablePaise` - the hand-maintained column that
   *   drifts, exactly like `currentBalancePaise` on the customer side, which
   *   this codebase already refuses to use for that reason. Once real purchase
   *   bills existed the dashboard would have shown ₹0 owed while the Payables
   *   screen showed the truth. Two screens disagreeing is worse than one being
   *   missing: it destroys confidence in both, and in everything near them.
   *
   *   STOCK VALUE multiplied quantity by `dlpPaise` - the SELLING price. That
   *   values the shelf at what you hope to get for it rather than what you paid,
   *   overstating it by the entire gross margin. On 30% margins that is a ~43%
   *   overstatement of an asset figure, and nothing on screen hinted at it.
   *
   * Both now call the functions the Payables and Stock screens call, so the
   * dashboard cannot disagree with the screen a user clicks through to.
   */
  // Sequential, not Promise.all - each of these three helper calls issues its
  // own query (or several) against the same PgBouncer connection this whole
  // request is holding at `connection_limit=1` (see CLAUDE.md). Five
  // concurrent DB-touching calls fighting over one connection doesn't run any
  // faster than sequential - it just adds connection-acquisition contention
  // on top, which gets worse as real data volume (and concurrent staff
  // hitting this same dashboard) grows. Found live, 20 Sep 2026, while
  // investigating reported production slowness after the Vcare Global load.
  const supplierRows = await supplierBalances(scope);
  const stockVal = await stockValuation(scope);
  // Financial-year range, matching `saleFyPaise` above. A dashboard showing
  // year-to-date sales next to this-month's profit would invite exactly the
  // wrong comparison.
  const pnl = await profitAndLoss(scope, fyStart, fyEnd);
  /**
   * The real figures, from the general ledger (D011, workstream G).
   *
   * `profitAndLoss` above is still used for the monthly chart and the
   * expenses breakdown, which it does well. But the headline Profit tile now
   * comes from GL postings when there are any - the dashboard apologised
   * "Needs the Accounts module" for months while a posted double-entry ledger
   * sat beside it.
   */
  const gl = await glSummary(scope, fyStart, fyEnd);
  // Staff Balance was the literal constant 0 with the comment "HRM not built".
  const staff = await listUserAccounts(scope).catch(() => null);
  /**
   * EVERY source, not just the phone (workstream G, 1 Oct 2026).
   *
   * This used to filter `source: 'app'`, left over from before the 18 Sep
   * attendance unification. Once F2.5 shipped biometric capture it stopped
   * being merely narrow and became misleading: a branch where everybody
   * punches a fingerprint reader showed Present 0, and the dashboard carried
   * a badge saying attendance was not built. Both were wrong.
   *
   * This deliberately CHANGES what the widget means - it now counts anybody
   * who clocked in by any method - which is the honest reading of a tile
   * labelled "Total Attendance".
   */
  const todayShifts = await db.attendanceSession.findMany({
    where: {
      ...where,
      startedAt: { gte: startOfToday },
    },
    select: { userId: true, endedAt: true, autoClosed: true },
  });

  // Posted bills only. A draft has not put stock on the shelf and is not
  // money owed, so charting it would show spending that has not happened.
  const fyBills = await db.purchaseBill.findMany({
    where: {
      ...where,
      lifecycle: 'received',
      billDate: { gte: fyStart, lte: fyEnd },
    },
    select: {
      billDate: true,
      items: { select: { lineTotalPaise: true, movedStock: true } },
    },
  });

  /**
   * Headcount to measure attendance against.
   *
   * Only people with a PAIRED PHONE are counted, not every employee. Somebody
   * with no device cannot start a shift, so counting them would report a
   * permanent "12 unmarked" that never goes down and that nobody can act on -
   * and a number nobody can act on is a number everybody learns to ignore.
   */
  const pairedStaff = await db.callSyncDevice.findMany({
    where: { ...where, isActive: true },
    select: { userId: true },
    distinct: ['userId'],
  });

  const payablePaise = supplierRows.reduce((n, s) => n + s.outstandingPaise, 0);
  const stockValuePaise = stockVal.valuePaise;

  // ---- stock ---------------------------------------------------------------
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const stock = {
    outOfStock: balances.filter((b) => b.currentQty <= 0).length,
    lowStock: balances.filter((b) => b.currentQty > 0 && b.currentQty <= b.reorderLevel).length,
    timeForPo: balances.filter((b) => b.currentQty <= b.reorderLevel).length,
    nonMoving: balances.filter((b) => !b.lastSoldAt || b.lastSoldAt < ninetyDaysAgo).length,
  };

  // ---- monthly series ------------------------------------------------------
  //
  // Indexed April(0) .. March(11) so the chart reads as a financial year.
  //
  // `purchasePaise` and `expensePaise` were hardcoded to zero until 9 Sep 2026,
  // which drew two permanently flat lines across the chart. A flat line is not
  // read as "no data" - it is read as "we bought nothing", and against a rising
  // sales line it makes the business look far healthier than it is.
  const monthly = MONTHS.map((label) => ({
    label, salePaise: 0, purchasePaise: 0, expensePaise: 0,
  }));
  for (const o of orders) {
    if (o.orderDate < fyStart || o.orderDate > fyEnd) continue;
    const idx = (istMonth(o.orderDate) + 9) % 12;   // Apr = 0, India calendar
    monthly[idx].salePaise += o.grandTotalPaise;
  }
  for (const b of fyBills) {
    const idx = (istMonth(b.billDate) + 9) % 12;
    // Stock bought is a PURCHASE; a non-stock line - rent, a repair, freight -
    // is an EXPENSE. Splitting them matters: purchases become cost of goods
    // sold only when the goods sell, expenses hit the month they land in.
    for (const item of b.items) {
      if (item.movedStock) monthly[idx].purchasePaise += item.lineTotalPaise;
      else monthly[idx].expensePaise += item.lineTotalPaise;
    }
  }

  // ---- customers overview --------------------------------------------------
  const byTypeMap = new Map<string, number>();
  for (const c of customers) {
    const key = c.customerType?.name ?? 'Unclassified';
    byTypeMap.set(key, (byTypeMap.get(key) ?? 0) + 1);
  }

  // ---- accounts ------------------------------------------------------------
  const accounts = {
    due: customers.filter((c) => balanceOf(c.id) > 0).length,
    overDue: customers.filter(
      (c) => balanceOf(c.id) > 0 && c.dueDate != null && c.dueDate < startOfToday,
    ).length,
    dueToday: customers.filter(
      (c) => balanceOf(c.id) > 0 && c.dueDate != null
        && c.dueDate.toDateString() === now.toDateString(),
    ).length,
    crossedLimit: customers.filter(
      (c) => c.creditLimitPaise > 0 && balanceOf(c.id) > c.creditLimitPaise,
    ).length,
  };

  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const spMap = new Map<string, number>();
  for (const c of customers) {
    if (balanceOf(c.id) <= 0 || !c.assignedManagerId) continue;
    const name = userName.get(c.assignedManagerId) ?? 'Unassigned';
    spMap.set(name, (spMap.get(name) ?? 0) + balanceOf(c.id));
  }

  // ---- pipeline ------------------------------------------------------------
  const leadStage = (name: string) =>
    leads.filter((l) => (l.stage?.name ?? '').toLowerCase().includes(name)).length;

  const catCount = new Map<string, number>();
  for (const p of products) {
    const key = p.category?.name ?? 'Uncategorised';
    catCount.set(key, (catCount.get(key) ?? 0) + 1);
  }

  return {
    financial: {
      outstandingPaise,
      customerCount: customers.length,
      staffBalancePaise: staff?.cards.outstandingPaise ?? 0,
      saleFyPaise: ordersFy._sum.grandTotalPaise ?? 0,
      orderCount: ordersFy._count,
      stockValuePaise,
      supplierCount: suppliers.length,
      /**
       * From the ledger where the ledger has anything, and only otherwise from
       * the indicative calculation - which is still better than zero, because
       * "profit: ₹0" on a dashboard is not a caveat, it is a lie.
       */
      profitPaise: gl.empty ? pnl.indicativeNetPaise : gl.profitPaise,
      profitFromLedger: !gl.empty,
      invoiceDuePaise: orders.reduce((n, o) => n + (o.grandTotalPaise - o.amountPaidPaise), 0),
      expensesPaise: gl.empty ? pnl.expensesPaise : gl.expensesPaise,
      payablePaise,
    },
    /**
     * Attendance, from the phones - no longer zeroed.
     *
     * `present` counts distinct PEOPLE, not shifts: somebody who clocked out
     * for lunch and back in again is one person at work, not two.
     *
     * `unmarked` is everyone active who has not started a shift today. That is
     * the number a manager acts on at 10am, and it is deliberately not called
     * "absent" - a salesperson out on the road who forgot the app is not
     * absent, and labelling them so is how the feature earns a reputation for
     * lying about people.
     */
    attendance: (() => {
      const started = new Set(todayShifts.map((s) => s.userId));
      return {
        present: started.size,
        // Still on shift right now.
        late: todayShifts.filter((s) => !s.endedAt).length,
        unmarked: Math.max(0, pairedStaff.length - started.size),
        absent: 0,
      };
    })(),
    monthly,
    customers: {
      // A repeat buyer is one with more than a single order. Until order history
      // per customer exists, everyone with a recorded purchase counts as
      // one-time - deliberately conservative rather than flattering.
      oneTime: customers.filter((c) => c.lastPurchaseAt != null).length,
      repeat: 0,
      byType: [...byTypeMap.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      total: customers.length,
    },
    approvals: {
      salesOrder: orders.filter((o) => o.fulfilmentStatus === 'pending_approval').length,
      customerPayment: 0, expense: 0, purchaseOrder: 0, supplierPayment: 0, leave: 0,
    },
    stock,
    pipeline: {
      tasks: await taskPipelineCounts(scope),
      services: { total: 0, newLead: 0, pending: 0, completed: 0, invoiced: 0 },
      leads: {
        total: leads.length,
        contacted: leadStage('contact'),
        inProgress: leadStage('progress'),
        closed: leads.filter((l) => l.isClosed).length,
        won: leads.filter((l) => l.convertedCustomerId != null).length,
        lost: leads.filter((l) => l.isClosed && l.convertedCustomerId == null).length,
      },
    },
    topCategories: [...catCount.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    accounts,
    salespersonBalances: [...spMap.entries()]
      .map(([name, paise]) => ({ name, paise }))
      .sort((a, b) => b.paise - a.paise)
      .slice(0, 6),
    recent: activity.map((a) => ({
      id: a.id,
      type: a.entityType,
      description: a.description,
      amount: a.amount ? Number(a.amount) : null,
      at: a.createdAt,
    })),
    notices: (await listNotices(scope)).slice(0, 5).map((n) => ({ id: n.id, title: n.title, pinned: n.pinned })),
    amc: await amcAttention(scope, now),
  };
}

/**
 * The maintenance contracts that need a person to do something.
 *
 * Its own function, and its own narrow query, rather than reusing
 * `summariseAmcContracts` - that lives in server/amc.ts which imports
 * server/invoices.ts, and having the dashboard pull that whole chain in for
 * five numbers is more coupling than the numbers are worth. The RULES are
 * still shared (lib/expiry, lib/amc-offer), which is the part that must not
 * drift.
 *
 * Selects six scalar columns. Cheap enough to sit on the dashboard's critical
 * path even on a store with thousands of contracts.
 */
async function amcAttention(scope: StoreScope, now: Date) {
  const rows = await db.amcContract.findMany({
    where: { ...scopeWhere(scope), status: { in: ['active', 'expired'] } },
    select: {
      id: true, contractNo: true, status: true, endDate: true, reminderDays: true,
      amountPaise: true, invoiceId: true,
      customer: { select: { companyName: true, firstName: true, lastName: true } },
    },
    orderBy: { endDate: 'asc' },
    take: LIST_MAX_ROWS,
  });

  let dueForRenewal = 0;
  let lapsed = 0;
  let awaitingInvoice = 0;
  let awaitingInvoicePaise = 0;
  let activeValuePaise = 0;
  const due: typeof rows = [];

  for (const r of rows) {
    if (billingState({ amountPaise: r.amountPaise, invoiceId: r.invoiceId }) === 'awaiting_invoice') {
      awaitingInvoice++;
      awaitingInvoicePaise += r.amountPaise;
    }

    if (r.status !== 'active') continue;
    activeValuePaise += r.amountPaise;

    const s = expiryState({ expiryDate: r.endDate, reminderDays: r.reminderDays }, now);
    if (s.isOverdue) { lapsed++; due.push(r); }
    else if (s.isDue) { dueForRenewal++; due.push(r); }
  }

  return {
    dueForRenewal,
    lapsed,
    awaitingInvoice,
    awaitingInvoicePaise,
    activeValuePaise,
    // Already sorted by endDate, so the first few are the most urgent.
    soonest: due.slice(0, 4).map((r) => ({
      id: r.id,
      contractNo: r.contractNo,
      customerName: r.customer.companyName?.trim()
        || [r.customer.firstName, r.customer.lastName].filter(Boolean).join(' ').trim(),
      daysToExpiry: expiryState(
        { expiryDate: r.endDate, reminderDays: r.reminderDays }, now,
      ).daysToExpiry,
    })),
  };
}

/* ------------------------------------------------------------------------ */

export interface SalesTabData {
  quotation: {
    draft: number; sent: number; accepted: number; converted: number; expired: number;
    rejected: number;
    /** Everything not named above, so the buckets always sum to the total. */
    other: number;
    total: number;
    openValuePaise: number;
  };
  orders: {
    booked: number; pendingApproval: number; inProgress: number;
    delivered: number; onHold: number; cancelled: number;
    /** Everything not named above, so the buckets always sum to the total. */
    other: number;
    total: number;
    valuePaise: number; duePaise: number;
  };
  invoices: { draft: number; pending: number; partial: number; paid: number; overdue: number; receivablePaise: number };
  funnel: { label: string; count: number; valuePaise: number }[];
  topCustomers: { name: string; orders: number; paise: number }[];
  topProducts: { name: string; qty: number; paise: number }[];
  targets: { name: string; targetPaise: number; achievedPaise: number; pct: number | null }[];
  conversion: { quotationsSent: number; converted: number; ratePct: number | null; avgOrderPaise: number };
  /**
   * Sales incentive (workstream H, 1 Oct 2026).
   *
   * It existed on its own screen and appeared on no dashboard. An incentive
   * nobody can see does not motivate anybody, and an owner who cannot see
   * what is owed finds out at payout time.
   */
  incentive: {
    earnedPaise: number;
    pendingPaise: number;
    paidPaise: number;
    deals: number;
    /** The scheme in force, in words, so the figure can be defended. */
    basis: string;
    earnedOn: string;
  };
}

/**
 * The Sales tab of the dashboard.
 *
 * Loaded separately from the Admin tab rather than folded into it, because
 * most visits only ever look at Admin and this is another six queries. The
 * reference splits its dashboard the same way.
 *
 * Every figure here is derived on read. None of it is a stored rollup, so
 * cancelling an order corrects the dashboard immediately rather than waiting
 * for something to recompute.
 */
export async function getSalesTab(scope: StoreScope, fy?: number): Promise<SalesTabData> {
  const year = fy ?? getFinancialYear();
  const { start, end } = financialYearRange(year);
  const now = new Date();

  const [quotations, orders, invoices, orderItems, targets, users] = await db.$transaction([
    db.quotation.findMany({
      where: { ...scopeWhere(scope), closedAt: null },
      select: { status: true, grandTotalPaise: true, validUntil: true },
    }),
    db.salesOrder.findMany({
      where: { ...scopeWhere(scope), closedAt: null },
      select: {
        fulfilmentStatus: true, grandTotalPaise: true, amountPaidPaise: true,
        customerName: true, salespersonId: true, orderDate: true,
      },
    }),
    db.invoice.findMany({
      where: { ...scopeWhere(scope), closedAt: null },
      select: { lifecycle: true, grandTotalPaise: true, amountPaidPaise: true, dueDate: true },
    }),
    db.salesOrderItem.findMany({
      where: { salesOrder: { ...scopeWhere(scope), closedAt: null, orderDate: { gte: start, lte: end } } },
      select: { productName: true, qty: true, lineTotalPaise: true },
    }),
    db.userTarget.findMany({
      where: { ...scopeWhere(scope), periodType: 'fy', periodStart: start },
      select: { userId: true, targetPaise: true },
    }),
    // Scoped for the same reason as the lookup in `getDashboard` above.
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
  ]);

  // Expiry is derived, exactly as the Quotation screen derives it - a stored
  // flag would need a job to stay true and would disagree the moment it lapsed.
  // The same isExpired the Quotation screen uses. My first version inlined the
  // rule here, which is how the dashboard ends up disagreeing with the list it
  // is supposed to be summarising - and the dashboard is the one people
  // believe, because it is the one they look at first.
  const qStatus = (q: { status: string; validUntil: Date }) =>
    isExpired(q.validUntil, q.status as QuotationStatus, now) ? 'expired' : q.status;

  const qCount = (s: string) => quotations.filter((q) => qStatus(q) === s).length;

  /**
   * Buckets that add up.
   *
   * The first version named booked, in-progress, delivered and cancelled, and
   * an order sitting at Pending Approval matched none of them - so it vanished
   * from the strip while still counting in the funnel above it. A summary whose
   * parts do not sum to the whole is worse than no summary, because the reader
   * cannot tell which number to trust.
   *
   * `other` catches whatever is left, so adding a status to the state machine
   * later shows up as an unexplained count rather than silently disappearing.
   */
  const IN_PROGRESS = ['confirmed', 'packed', 'dispatched', 'shipped'];
  const oCount = (f: (s: string) => boolean) =>
    orders.filter((o) => f(o.fulfilmentStatus)).length;

  const invStatus = (i: { lifecycle: string; grandTotalPaise: number; amountPaidPaise: number; dueDate: Date }) =>
    invoiceStatus({
      lifecycle: i.lifecycle as InvoiceLifecycle,
      grandTotalPaise: i.grandTotalPaise,
      amountPaidPaise: i.amountPaidPaise,
      dueDate: i.dueDate,
    }, now);

  const iCount = (s: string) => invoices.filter((i) => invStatus(i) === s).length;

  const byCustomer = new Map<string, { orders: number; paise: number }>();
  for (const o of orders) {
    if (!countsAsRevenue(o.fulfilmentStatus)) continue;
    const cur = byCustomer.get(o.customerName) ?? { orders: 0, paise: 0 };
    byCustomer.set(o.customerName, {
      orders: cur.orders + 1,
      paise: cur.paise + o.grandTotalPaise,
    });
  }

  const byProduct = new Map<string, { qty: number; paise: number }>();
  for (const it of orderItems) {
    const cur = byProduct.get(it.productName) ?? { qty: 0, paise: 0 };
    byProduct.set(it.productName, { qty: cur.qty + it.qty, paise: cur.paise + it.lineTotalPaise });
  }

  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const achievedByUser = new Map<string, number>();
  for (const o of orders) {
    if (!o.salespersonId) continue;
    if (!countsAsRevenue(o.fulfilmentStatus)) continue;
    if (o.orderDate < start || o.orderDate > end) continue;
    achievedByUser.set(o.salespersonId, (achievedByUser.get(o.salespersonId) ?? 0) + o.grandTotalPaise);
  }

  /**
   * Loaded outside the transaction above: both are small reads and neither
   * needs to be consistent with the order snapshot to the millisecond.
   * `.catch` because a dashboard tile must never take the page down.
   */
  const [incentives, incentiveRule] = await Promise.all([
    listIncentives(scope).catch(() => null),
    scope.kind === 'single'
      ? getIncentiveRule(scope.storeId).catch(() => DEFAULT_RULE)
      : Promise.resolve(DEFAULT_RULE),
  ]);

  const sent = quotations.filter((q) => qStatus(q) !== 'draft').length;
  const converted = qCount('converted');
  const liveOrders = orders.filter((o) => !!countsAsRevenue(o.fulfilmentStatus));
  const orderValue = liveOrders.reduce((n, o) => n + o.grandTotalPaise, 0);

  return {
    incentive: {
      earnedPaise: incentives?.cards.totalAmountPaise ?? 0,
      pendingPaise: incentives?.cards.pendingPaise ?? 0,
      paidPaise: incentives?.cards.paidPaise ?? 0,
      deals: incentives?.cards.totalIncentives ?? 0,
      basis: BASIS_LABEL[incentiveRule.basis],
      earnedOn: EARNED_ON_LABEL[incentiveRule.earnedOn],
    },
    quotation: {
      draft: qCount('draft'), sent: qCount('sent'), accepted: qCount('accepted'),
      converted, expired: qCount('expired'), rejected: qCount('rejected'),
      // The same guard the order strip already carried. A rejected quotation
      // was counted nowhere, so the strip read 11 against a total of 12 and
      // nothing on screen said which one was missing.
      other: quotations.filter(
        (q) => !['draft', 'sent', 'accepted', 'converted', 'expired', 'rejected']
          .includes(qStatus(q)),
      ).length,
      total: quotations.length,
      openValuePaise: quotations
        .filter((q) => ['draft', 'sent'].includes(qStatus(q)))
        .reduce((n, q) => n + q.grandTotalPaise, 0),
    },
    orders: {
      booked: oCount((s) => s === 'booked'),
      pendingApproval: oCount((s) => s === 'pending_approval'),
      inProgress: oCount((s) => IN_PROGRESS.includes(s)),
      delivered: oCount((s) => s === 'delivered'),
      onHold: oCount((s) => s === 'hold'),
      cancelled: oCount((s) => !countsAsRevenue(s)),
      other: oCount((s) => ![
        'booked', 'pending_approval', 'delivered', 'hold', ...IN_PROGRESS,
      ].includes(s) && countsAsRevenue(s)),
      total: orders.length,
      valuePaise: orderValue,
      duePaise: liveOrders.reduce((n, o) => n + (o.grandTotalPaise - o.amountPaidPaise), 0),
    },
    invoices: {
      draft: iCount('draft'), pending: iCount('pending'),
      partial: iCount('partially_paid'), paid: iCount('paid'), overdue: iCount('overdue'),
      // Shared, not restated. Counting drafts here made this tile read 68,882
      // while the Invoices screen correctly said 33,482 - one draft apart.
      receivablePaise: outstandingOf(invoices),
    },
    // The funnel is counted at each stage, not filtered down - a quotation that
    // became an order is still a quotation that was raised, and hiding it would
    // make the conversion rate meaningless.
    funnel: [
      { label: 'Quotations', count: quotations.length,
        valuePaise: quotations.reduce((n, q) => n + q.grandTotalPaise, 0) },
      { label: 'Orders', count: liveOrders.length, valuePaise: orderValue },
      { label: 'Invoiced', count: invoices.length,
        valuePaise: invoices.reduce((n, i) => n + i.grandTotalPaise, 0) },
      { label: 'Collected', count: invoices.filter((i) => invStatus(i) === 'paid').length,
        valuePaise: invoices.reduce((n, i) => n + i.amountPaidPaise, 0) },
    ],
    topCustomers: [...byCustomer.entries()]
      .map(([n, v]) => ({ name: n, ...v }))
      .sort((a, b) => b.paise - a.paise)
      .slice(0, 5),
    topProducts: [...byProduct.entries()]
      .map(([n, v]) => ({ name: n, ...v }))
      .sort((a, b) => b.paise - a.paise)
      .slice(0, 5),
    targets: targets.map((t) => {
      const achieved = achievedByUser.get(t.userId) ?? 0;
      return {
        name: name.get(t.userId) ?? 'Unknown',
        targetPaise: t.targetPaise,
        achievedPaise: achieved,
        // null, not 0 - nobody set a target, so there is no percentage to give.
        pct: t.targetPaise > 0 ? (achieved / t.targetPaise) * 100 : null,
      };
    }).sort((a, b) => b.achievedPaise - a.achievedPaise),
    conversion: {
      quotationsSent: sent,
      converted,
      ratePct: sent > 0 ? (converted / sent) * 100 : null,
      avgOrderPaise: liveOrders.length > 0 ? Math.round(orderValue / liveOrders.length) : 0,
    },
  };
}
