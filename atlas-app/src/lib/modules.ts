import type { SellableModule } from './plans';

/**
 * WHICH MODULE OWNS WHAT (F-01, 5 Oct 2026).
 *
 * The platform owner can switch a module off for a business (Platform >
 * Tenants > plan / excluded modules). Until today that only removed the
 * module's top-level sidebar group: the pages still opened from a bookmark,
 * the phone app's APIs still answered, Settings still listed its settings,
 * search still found it and approval rules still offered it.
 *
 * This is the one map every door checks: pages, phone APIs, Settings entries,
 * approval types, search results and handbook chapters. A path belongs to the
 * module of its LONGEST matching prefix, so `/hrm/payroll` and `/settings/
 * attendance` land where they should. Paths in no module (dashboard, My Desk,
 * Settings itself, platform screens) are never switched off.
 */
const PREFIXES: [string, SellableModule][] = [
  // Sales
  ['/crm', 'Sales'], ['/customers', 'Sales'], ['/quotation', 'Sales'], ['/q/', 'Sales'], ['/i/', 'Sales'], ['/o/', 'Sales'], ['/sales/', 'Sales'], ['/invoices', 'Sales'],
  ['/call-logs', 'Sales'], ['/my/target', 'Sales'], ['/settings/user-target', 'Sales'], ['/settings/incentive', 'Sales'],
  ['/settings/documents', 'Sales'],
  // Inventory
  ['/reports/product-stock', 'Inventory'], ['/reports/stock-health', 'Inventory'], ['/manufacturing', 'Inventory'],
  ['/goods-dispatch', 'Inventory'], ['/goods-receipt', 'Inventory'], ['/product-journey', 'Inventory'],
  ['/stock-units', 'Inventory'], ['/van-stock', 'Inventory'],
  // Service
  ['/services', 'Customer Service'], ['/service', 'Customer Service'], ['/c/', 'Customer Service'], ['/settings/field-jobs', 'Customer Service'],
  // Tasks
  ['/tasks', 'Task Manager'],
  // Products
  ['/products', 'Products'], ['/catalogue', 'Products'], ['/settings/masters', 'Products'],
  // Suppliers
  ['/suppliers', 'Suppliers'], ['/supplier', 'Suppliers'],
  // Accounts
  ['/receipts', 'Accounts'], ['/reports/gst', 'Accounts'], ['/transactions', 'Accounts'], ['/customer/account', 'Accounts'],
  ['/user/account', 'Accounts'], ['/courier', 'Accounts'], ['/sales-return', 'Accounts'], ['/credit-notes', 'Accounts'],
  ['/employee/incentive', 'Accounts'], ['/bank', 'Accounts'], ['/settings/period-lock', 'Accounts'],
  ['/settings/chart-of-accounts', 'Accounts'], ['/settings/opening-balance', 'Accounts'],
  // Purchase
  ['/purchase', 'Purchase'], ['/purchase-return', 'Purchase'],
  // HRM
  ['/hrm', 'HRM'], ['/attendance', 'HRM'], ['/employee/attendance', 'HRM'], ['/holiday', 'HRM'], ['/hierarchy', 'HRM'],
  ['/assets', 'HRM'], ['/helpdesk', 'HRM'], ['/departments', 'HRM'], ['/settings/attendance', 'HRM'],
  ['/settings/employees', 'HRM'],
  ['/hrm/employee-config', 'HRM Configurations'],
  // Financial reports
  ['/reports/profit-loss', 'Financial Reports'], ['/reports/balance-sheet', 'Financial Reports'],
  ['/reports/document-numbers', 'Financial Reports'],
  // Common Hub
  ['/notices', 'Common Hub'], ['/files', 'Common Hub'], ['/terms', 'Common Hub'],
  // Reference data
  ['/settings/custom-fields', 'Reference Data'],
];

/** Phone-app API areas (`/api/v1/<area>`). Personal ones (desk, auth, approvals) belong to no module. */
const API_PREFIXES: [string, SellableModule][] = [
  ['/api/v1/jobs/complaints', 'Customer Service'], ['/api/v1/jobs/my-work', 'Customer Service'], ['/api/v1/jobs/visits', 'Customer Service'],
  ['/api/v1/jobs/installations', 'Customer Service'], ['/api/v1/jobs/mine', 'Customer Service'], ['/api/v1/office/jobs', 'Customer Service'], ['/api/v1/jobs/attachments', 'Customer Service'], ['/api/v1/jobs/leads', 'Sales'], ['/api/v1/jobs/tasks', 'Task Manager'],
  ['/api/v1/calls', 'Sales'], ['/api/v1/stock', 'Inventory'], ['/api/v1/scan', 'Inventory'], ['/api/v1/attendance', 'HRM'],
  ['/api/v1/shop', 'Products'], ['/api/v1/sales', 'Sales'], ['/api/v1/customers', 'Sales'], ['/api/v1/people', 'HRM'], ['/api/v1/money', 'Accounts'], ['/api/v1/shop-requests', 'Sales'],
];

/**
 * THE WEB PAGE EACH PHONE AREA STANDS FOR (F-01, 10 Oct 2026).
 *
 * `excludedPages` names web routes, and the phone has no routes - it has five
 * or six areas. Without this table, switching off Call Logs for a client
 * would take it out of the website and leave `/api/v1/calls` answering, which
 * is precisely the class of hole F-01 was opened for.
 *
 * Only the pairs where one web page genuinely owns the same capability are
 * listed. `/api/v1/scan`, `/api/v1/shop` and the personal areas (desk, auth,
 * approvals) have no single owning page and are governed by their module
 * alone, which is the honest answer rather than a guessed one.
 */
const API_PAGE: [string, string][] = [
  ['/api/v1/calls', '/call-logs'],
  ['/api/v1/attendance', '/attendance'],
  ['/api/v1/jobs/complaints', '/services/complaints'],
  ['/api/v1/jobs/mine', '/services/complaints'],
  ['/api/v1/office/jobs', '/services/complaints'],
  ['/api/v1/jobs/visits', '/services/visits'],
  ['/api/v1/jobs/my-work', '/services/technicians'],
  ['/api/v1/jobs/leads', '/crm/leads'],
  ['/api/v1/sales/quotations', '/quotation'],
  ['/api/v1/sales/invoices', '/invoices'],
  ['/api/v1/sales/orders', '/sales/orders'],
  ['/api/v1/customers', '/customers'],
  ['/api/v1/people/today', '/attendance/team-today'],
  ['/api/v1/money', '/receipts'],
  ['/api/v1/shop-requests', '/sales/shop-requests'],
  ['/api/v1/jobs/tasks', '/tasks'],
];

/**
 * Which web page an API path answers for, so page-level hiding reaches the
 * phone. Longest prefix, same as everything else here.
 */
export function pageOfApi(path: string): string | null {
  const clean = path.split('?')[0]!;
  let best: [string, string] | null = null;
  for (const row of API_PAGE) {
    if ((clean === row[0] || clean.startsWith(`${row[0]}/`)) && (!best || row[0].length > best[0].length)) best = row;
  }
  return best ? best[1] : null;
}

function longest(path: string, table: [string, SellableModule][]): SellableModule | null {
  let best: [string, SellableModule] | null = null;
  for (const row of table) {
    const [p] = row;
    const hit = path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || (p.endsWith('/') && path.startsWith(p));
    if (hit && (!best || p.length > best[0].length)) best = row;
  }
  return best ? best[1] : null;
}

/** The module a page belongs to, or null when it belongs to none. */
export function moduleOfPath(path: string | null | undefined): SellableModule | null {
  if (!path) return null;
  return longest(path.split('?')[0], PREFIXES);
}

/** The module a phone-app API belongs to, or null. */
export function moduleOfApi(path: string): SellableModule | null {
  return longest(path.split('?')[0], API_PREFIXES);
}

/** The module an approval request type belongs to. */
const REQUEST_MODULE: Record<string, SellableModule> = {
  leave: 'HRM', wfh: 'HRM', comp_off: 'HRM', leave_allocation: 'HRM', reimbursement: 'HRM', leave_encashment: 'HRM',
  asset_request: 'HRM', resignation: 'HRM', payroll_process: 'HRM', payroll_paid: 'HRM', payroll_revert: 'HRM', staff_loan: 'HRM',
  sales_order: 'Sales', quotation_send: 'Sales', invoice_issue: 'Sales', invoice_cancel: 'Sales', invoice_edit: 'Sales',
  order_cancel_paid: 'Sales', credit_limit: 'Sales',
  price_change: 'Products',
  purchase_order: 'Purchase', purchase_bill: 'Purchase', debit_note: 'Purchase', supplier_payment: 'Purchase',
  supplier_payment_reverse: 'Purchase',
  credit_note: 'Accounts', sales_return: 'Accounts', refund: 'Accounts', receipt_reverse: 'Accounts', expense: 'Accounts',
  period_reopen: 'Accounts',
  installation_challan: 'Customer Service', repair_challan: 'Customer Service', site_override: 'Customer Service',
  job_challan: 'Customer Service', job_close: 'Customer Service', warranty_void: 'Customer Service',
  van_writeoff: 'Inventory',
};
export const moduleOfRequestType = (type: string): SellableModule | null => REQUEST_MODULE[type] ?? null;

/**
 * The sellable module behind each row of the Roles editor (lib/role-modules),
 * so a module the business does not have is not offered there (6 Oct 2026).
 * Rows in none (dashboard, users, settings) always show.
 */
const ROLE_MODULE_OWNER: Record<string, SellableModule> = {
  leads: 'Sales', customers: 'Sales', quotation: 'Sales', orders: 'Sales', invoice: 'Sales', calls: 'Sales',
  returns: 'Accounts', accounts: 'Accounts',
  products: 'Products', stock: 'Inventory', purchase: 'Purchase',
  complaints: 'Customer Service', installations: 'Customer Service', amc: 'Customer Service',
  attendance: 'HRM', hrm: 'HRM', renewals: 'HRM', payroll: 'HRM', helpdesk: 'HRM', assets: 'HRM',
  tasks: 'Task Manager',
};
export const moduleOfRoleModule = (key: string): SellableModule | null => ROLE_MODULE_OWNER[key] ?? null;

/** Is this path / API / type switched off for a business that excludes these modules? */
export const isExcluded = (module: SellableModule | null, excluded: ReadonlySet<string>) => !!module && excluded.has(module);

/**
 * IS THIS ONE PAGE SWITCHED OFF FOR THIS BUSINESS? (F-01, 10 Oct 2026)
 *
 * The finer grain Pravin asked for, beside `isExcluded`'s whole-module one.
 * Longest prefix wins and a prefix covers its children, so hiding
 * `/hrm/payroll` hides `/hrm/payroll/travel` and `/hrm/payroll/run/abc123`
 * with it - which is the only behaviour that makes sense, since a detail page
 * nobody can reach the list of is not hidden, it is a trap.
 *
 * Checked at the same doors as `isExcluded`: the route guard, the sidebar,
 * global search, the Settings hub and the Roles editor. `lib/plans.isHideable`
 * decides what may be put in this set in the first place.
 */
export function isPageHidden(path: string | null | undefined, hidden: ReadonlySet<string>): boolean {
  if (!path || hidden.size === 0) return false;
  const clean = path.split('?')[0]!;
  for (const p of hidden) {
    if (clean === p || clean.startsWith(`${p}/`)) return true;
  }
  return false;
}

/**
 * One call for both grains, because every door needs both and forgetting the
 * second one is exactly the bug F-01 was opened for.
 */
export const isPageOff = (
  path: string | null | undefined,
  excludedModules: ReadonlySet<string>,
  excludedPages: ReadonlySet<string>,
): boolean => isExcluded(moduleOfPath(path), excludedModules) || isPageHidden(path, excludedPages);
