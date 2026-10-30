/**
 * Who may open which page - the ONE place it is decided (health check SEC-1,
 * 25 Sep 2026).
 *
 * Before this, the side menu hid pages a role should not see, but the pages
 * themselves mostly did not check: anyone signed in could type the address of
 * a payslip, the P&L or the call log. Now `requireContext()` looks up the
 * requested path here on every page load and server action, so a page cannot
 * forget - and `route-access-coverage.test.ts` fails the build if a page is
 * added under (app) without an entry.
 *
 * Longest prefix wins. `null` = anyone signed in (the common hub, self-service
 * pages). Otherwise ANY one of the listed permissions opens the page; what the
 * person may then DO on it is still checked by each action.
 */

export type RouteRule = readonly string[] | null;

const V = {
  leads: ['leads.view', 'leads.edit', 'leads.create'],
  customers: ['customers.view', 'customers.edit', 'customers.create'],
  quotation: ['quotation.view', 'quotation.create', 'quotation.edit'],
  orders: ['orders.view', 'orders.create', 'orders.edit'],
  invoice: ['invoice.view', 'invoice.create', 'invoice.edit'],
  returns: ['returns.view', 'returns.edit', 'returns.credit'],
  products: ['products.view', 'products.edit'],
  stock: ['stock.view', 'stock.adjust'],
  purchase: ['purchase.view', 'purchase.edit', 'purchase.approve', 'purchase.pay'],
  accounts: ['accounts.view', 'accounts.edit'],
  calls: ['calls.view', 'calls.manage'],
  complaints: ['complaints.view', 'complaints.edit'],
  attendance: ['attendance.view', 'attendance.edit'],
  hrm: ['hrm.view', 'hrm.edit'],
  payroll: ['payroll.view', 'payroll.process', 'payroll.configure'],
  users: ['users.view', 'users.edit'],
  settings: ['settings.view', 'settings.edit'],
  helpdesk: ['helpdesk.view', 'helpdesk.edit'],
  renewals: ['renewals.view', 'renewals.edit'],
  amc: ['amc.view', 'amc.edit'],
  installations: ['installations.view', 'installations.edit'],
  assets: ['assets.view', 'assets.edit'],
} as const;

export const ROUTE_ACCESS: Record<string, RouteRule> = {
  // Everyone signed in - their own things and the common hub.
  '/dashboard': null,
  '/user/account': null,
  '/employee': null,
  '/files': null,
  '/handbook': null,
  '/messages': null,
  '/notices': null,
  '/tasks': null,
  // My Reminders & Requests - everyone, filtered to them (27 Sep 2026).
  '/my': null,
  '/terms': null,
  '/no-access': null,
  // Call Logs shows the whole branch to calls.view and "My calls" to everyone
  // else - the page itself narrows it (decision 1, 25 Sep 2026).
  '/call-logs': null,

  // Sales & CRM
  '/crm/leads': V.leads,
  '/customers': V.customers,
  '/customer/account': [...V.customers, ...V.accounts],
  '/quotation': V.quotation,
  '/sales/orders': V.orders,
  // What customers asked for in the online shop (13 Oct 2026) - for whoever works leads or jobs.
  '/sales/shop-requests': [...V.leads, ...V.complaints],
  '/invoices': V.invoice,
  '/receipts': [...V.invoice, ...V.accounts],
  '/credit-notes': V.returns,
  '/sales-return': V.returns,
  '/courier': [...V.orders, ...V.settings],

  // Products, stock, purchase
  '/products': V.products,
  '/catalogue': V.products,
  '/stock-units': V.stock,
  '/van-stock': V.stock,
  '/product-journey': V.stock,
  '/goods-dispatch': V.stock,
  '/manufacturing': V.stock,
  '/reports/product-stock': V.stock,
  '/reports/stock-health': V.stock,
  '/goods-receipt': [...V.purchase, ...V.stock],
  '/purchase': V.purchase,
  '/purchase-return': V.purchase,
  '/suppliers': V.purchase,
  '/supplier/account': [...V.purchase, ...V.accounts],

  // Money
  '/bank': V.accounts,
  '/transactions': V.accounts,
  // The read-only Accounts copies (9 Oct 2026). Same permission as the pages
  // they mirror - a copy that showed more than the original would be a leak.
  '/accounts/dashboard': V.accounts,
  '/accounts/sales-return': V.returns,
  '/accounts/credit-notes': V.returns,
  '/reports/balance-sheet': V.accounts,
  '/reports/profit-loss': V.accounts,
  '/reports/gst': V.accounts,
  '/reports/document-numbers': V.accounts,
  '/settings/period-lock': V.accounts,
  '/settings/chart-of-accounts': V.accounts,
  '/settings/opening-balance': V.accounts,

  // Reports - each download is filtered by its own permission on the page.
  '/reports/downloads': null,
  '/reports/activity-log': [...V.users, 'settings.edit'],

  // Service
  '/service': V.calls,
  // Own modules since 27 Sep 2026 (lib/role-modules SPLIT_MODULE_GRANTS).
  '/services/amc': V.amc,
  '/services/installations': V.installations,
  '/services': V.complaints,

  // Attendance & people
  '/attendance': V.attendance,
  '/settings/attendance': ['attendance.edit', 'hrm.edit', 'settings.edit'],
  '/holiday/leave-types': [...V.hrm, 'attendance.edit'],
  '/hrm/payroll': V.payroll,
  '/hrm/salary': V.payroll,
  '/hrm/loans': [...V.payroll, 'hrm.edit'],
  '/hrm/renewal': V.renewals,
  // G-37: one employee's page - opened from attendance and team screens too,
  // so attendance and user managers reach it; its payslips need payroll.
  '/hrm/employees': [...V.hrm, ...V.attendance, ...V.users],
  '/hrm': V.hrm,
  '/hierarchy': V.hrm,
  '/departments': [...V.hrm, ...V.users],
  '/assets': V.assets,
  '/helpdesk': V.helpdesk,

  // Administration
  // B2 Access check (11 Oct 2026) - read only, but it lists everyone's rights.
  '/settings/access': ['users.edit'],
  // B3 part 1 (11 Oct 2026) - one person, every screen about them. Read only.
  '/settings/people': ['users.edit'],
  '/settings/users': V.users,
  '/settings/user-store-roles': V.users,
  '/settings/roles': V.users,
  '/settings/user-target': [...V.users, ...V.leads],
  '/settings/login-sessions': V.users,
  '/settings/employees': [...V.users, ...V.hrm],
  '/settings/call-devices': ['devices.pair', 'calls.manage'],
  '/settings/approval-rules': ['settings.edit'],
  '/settings/operations': ['settings.edit'],
  '/settings/customisation': ['settings.edit'],
  '/settings': V.settings,
  '/import': ['settings.edit', 'customers.create', 'leads.create', 'products.edit'],
};

const KEYS = Object.keys(ROUTE_ACCESS).sort((a, b) => b.length - a.length);

/** The entry that governs `path`, or undefined when no entry covers it. */
export function routeEntry(path: string): string | undefined {
  const p = path.split('?')[0].replace(/\/+$/, '') || '/';
  return KEYS.find((k) => p === k || p.startsWith(`${k}/`));
}

/**
 * May someone with `permissions` open `path`? A path no entry covers is
 * allowed (the coverage test makes sure every real page HAS an entry, so this
 * only ever applies to non-page paths).
 */
export function canOpenRoute(path: string, permissions: ReadonlySet<string>): boolean {
  const key = routeEntry(path);
  if (!key) return true;
  const rule = ROUTE_ACCESS[key];
  return rule === null || rule.some((perm) => permissions.has(perm));
}
