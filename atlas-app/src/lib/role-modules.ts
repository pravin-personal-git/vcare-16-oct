/**
 * The Roles editor as ONE grid of modules (27 Sep 2026, streamline S3).
 *
 * Before: two independent lists per role - ~60 permission ticks and ~150
 * menu ticks - that had to agree by hand. A menu tick without the permission
 * showed a link that led to "no access" (Prachi's Leave), a permission
 * without the menu tick hid a page the person was allowed to use.
 *
 * Now: each module has one level - No access / View / Edit / Approve - plus
 * Delete and a few special switches where they exist. The side menu follows
 * the permissions automatically (lib/route-access decides what each page
 * needs; server/context drops links a person cannot open). Hiding a page
 * the role IS allowed into is still possible, as an exception list.
 *
 * Pure - used by the editor (client), the server and the tests.
 */

export type ModuleLevel = 'none' | 'view' | 'edit' | 'approve';

export interface RoleModule {
  key: string;
  label: string;
  group: string;
  /** Plain words for the admin: what this module covers. */
  hint: string;
  view: string[];
  edit: string[];
  approve?: string[];
  delete?: string[];
  /** Separate switches that do not fit a level. */
  extras?: { key: string; label: string }[];
}

export const ROLE_MODULES: RoleModule[] = [
  // Sales
  // No Delete tick: a lead is never deleted in Atlas, only closed as lost, so
  // `leads.delete` unlocked nothing and the tick lied (found 10 Oct 2026 by
  // the dead-permission check in lib/__tests__/action-registry.test.ts). The
  // key stays in the catalogue for databases that already hold it.
  { key: 'leads', label: 'Enquiries', group: 'Sales', hint: 'Enquiries and follow-ups', view: ['leads.view'], edit: ['leads.create', 'leads.edit'] },
  { key: 'customers', label: 'Customers', group: 'Sales', hint: 'Customer master and accounts', view: ['customers.view'], edit: ['customers.create', 'customers.edit'] },
  { key: 'quotation', label: 'Quotations', group: 'Sales', hint: 'Quotes to customers', view: ['quotation.view'], edit: ['quotation.create', 'quotation.edit'], approve: ['quotation.approve'], delete: ['quotation.delete'] },
  { key: 'orders', label: 'Sales orders', group: 'Sales', hint: 'Orders and delivery', view: ['orders.view'], edit: ['orders.create', 'orders.edit'], approve: ['orders.approve'] },
  { key: 'invoice', label: 'Invoices & receipts', group: 'Sales', hint: 'Bills to customers, money received', view: ['invoice.view'], edit: ['invoice.create', 'invoice.edit', 'invoice.costTrail'], approve: ['invoice.approve'] },
  { key: 'returns', label: 'Returns', group: 'Sales', hint: 'Goods coming back', view: ['returns.view'], edit: ['returns.edit'], extras: [{ key: 'returns.credit', label: 'Give money back (credit notes)' }] },
  { key: 'calls', label: 'Call logs (team)', group: 'Sales', hint: "Everyone's calls - own calls are always visible", view: ['calls.view'], edit: [], extras: [{ key: 'calls.manage', label: 'Manage phones' }, { key: 'devices.pair', label: 'Pair phones' }] },
  // Stock & purchase
  { key: 'products', label: 'Products', group: 'Stock & purchase', hint: 'Catalogue and prices', view: ['products.view'], edit: ['products.edit'] },
  { key: 'stock', label: 'Stock', group: 'Stock & purchase', hint: 'Stock, dispatch, manufacturing', view: ['stock.view'], edit: ['stock.adjust'] },
  { key: 'purchase', label: 'Purchase', group: 'Stock & purchase', hint: 'Suppliers, orders, bills, goods received', view: ['purchase.view'], edit: ['purchase.edit'], approve: ['purchase.approve'], extras: [{ key: 'purchase.pay', label: 'Pay suppliers' }] },
  // Service
  { key: 'complaints', label: 'Complaints & visits', group: 'Service', hint: 'Complaints, visits, repairs, replacements', view: ['complaints.view'], edit: ['complaints.edit'], approve: ['complaints.approve'] },
  { key: 'installations', label: 'Installation challans', group: 'Service', hint: 'New installations on site', view: ['installations.view'], edit: ['installations.edit'] },
  { key: 'amc', label: 'AMC contracts', group: 'Service', hint: 'Maintenance contracts and their billing', view: ['amc.view'], edit: ['amc.edit'] },
  // People
  { key: 'attendance', label: 'Attendance', group: 'People', hint: "Everyone's attendance - own is always visible", view: ['attendance.view'], edit: ['attendance.edit'], extras: [{ key: 'attendance.locate', label: 'See location trail' }] },
  { key: 'hrm', label: 'HR', group: 'People', hint: 'Employees, leave setup, hiring, org chart', view: ['hrm.view'], edit: ['hrm.edit'] },
  { key: 'renewals', label: 'Policy renewals', group: 'People', hint: 'Insurance and other policies, reminders', view: ['renewals.view'], edit: ['renewals.edit'] },
  { key: 'payroll', label: 'Payroll', group: 'People', hint: 'Salaries, payslips, claims', view: ['payroll.view'], edit: ['payroll.process'], extras: [{ key: 'payroll.configure', label: 'Set up salary structures' }] },
  { key: 'helpdesk', label: 'Helpdesk', group: 'People', hint: "Staff tickets - own tickets are always allowed", view: ['helpdesk.view'], edit: ['helpdesk.edit'] },
  { key: 'assets', label: 'Company assets', group: 'People', hint: 'Laptops, tools, who holds what', view: ['assets.view'], edit: ['assets.edit'] },
  // Money
  { key: 'accounts', label: 'Accounts', group: 'Money', hint: 'Bank, ledgers, P&L, GST', view: ['accounts.view'], edit: ['accounts.edit'] },
  // Administration
  { key: 'dashboard', label: 'Business dashboard', group: 'Administration', hint: 'Sales and money figures on the dashboard', view: ['dashboard.view'], edit: [] },
  { key: 'tasks', label: "Everyone's tasks", group: 'Administration', hint: 'Own tasks are always allowed', view: [], edit: ['tasks.edit'] },
  { key: 'users', label: 'Users & roles', group: 'Administration', hint: 'Who can log in and what they can do', view: ['users.view'], edit: ['users.edit'], extras: [{ key: 'users.viewPasswords', label: 'See passwords' }] },
  // "Create or link another business" is NOT offered here any more (10 Oct
  // 2026). It was a `business.selfService` tick that nothing read: the founder
  // decision of 25 Sep moved that right to the platform owner's switch plus
  // the built-in Admin role on purpose - "not a permission, because a tenant
  // admin can hand any permission to any role" (server/business-entitlements).
  // So the tick could be granted and the menu item still would not appear.
  { key: 'settings', label: 'Settings', group: 'Administration', hint: 'Business setup, approval rules, masters', view: ['settings.view'], edit: ['settings.edit'] },
];

const LEVELS: ModuleLevel[] = ['none', 'view', 'edit', 'approve'];

/** Which levels a module offers (a module with no view keys has no View step). */
export function levelsOf(m: RoleModule): ModuleLevel[] {
  return LEVELS.filter((l) => l === 'none'
    || (l === 'view' && m.view.length > 0)
    || (l === 'edit' && m.edit.length > 0)
    || (l === 'approve' && (m.approve?.length ?? 0) > 0));
}

/** Every key a level grants - cumulative (Edit includes View). */
export function keysForLevel(m: RoleModule, level: ModuleLevel): string[] {
  const upTo = LEVELS.indexOf(level);
  return [
    ...(upTo >= 1 ? m.view : []),
    ...(upTo >= 2 ? m.edit : []),
    ...(upTo >= 3 ? m.approve ?? [] : []),
  ];
}

export interface ModuleState {
  level: ModuleLevel;
  /** Holds keys that no single level explains (e.g. create but not edit). */
  custom: boolean;
  delete: boolean;
  extras: Record<string, boolean>;
}

/** Read a role's permission keys as grid cells. */
export function moduleState(m: RoleModule, keys: ReadonlySet<string>): ModuleState {
  const levelKeys = [...m.view, ...m.edit, ...(m.approve ?? [])];
  let level: ModuleLevel = 'none';
  for (const l of levelsOf(m)) {
    if (l !== 'none' && keysForLevel(m, l).every((k) => keys.has(k))) level = l;
  }
  const expected = new Set(keysForLevel(m, level));
  const custom = levelKeys.some((k) => keys.has(k) !== expected.has(k));
  return {
    level, custom,
    delete: (m.delete ?? []).length > 0 && (m.delete ?? []).every((k) => keys.has(k)),
    extras: Object.fromEntries((m.extras ?? []).map((x) => [x.key, keys.has(x.key)])),
  };
}

/** Apply one module's new cell to a role's key set; other modules are untouched. */
export function applyModule(keys: ReadonlySet<string>, m: RoleModule, next: Omit<ModuleState, 'custom'>): Set<string> {
  const out = new Set(keys);
  for (const k of [...m.view, ...m.edit, ...(m.approve ?? []), ...(m.delete ?? [])]) out.delete(k);
  for (const k of keysForLevel(m, next.level)) out.add(k);
  if (next.delete && next.level !== 'none') for (const k of m.delete ?? []) out.add(k);
  for (const x of m.extras ?? []) {
    if (next.extras[x.key]) out.add(x.key); else out.delete(x.key);
  }
  return out;
}

export const LEVEL_LABEL: Record<ModuleLevel, string> = { none: 'No access', view: 'View', edit: 'Edit', approve: 'Approve' };

/**
 * EVERY KEY THIS MODULE OWNS, in the order the editor lists them (10 Oct 2026).
 *
 * The four levels above are presets over this list. Pravin asked for the level
 * underneath them: "har button ko specific user role ko hi de paye". A level is
 * a bundle - Edit on Invoices is create AND change AND the cost trail - and a
 * bundle cannot express "raise invoices but never see our cost". So the editor
 * also offers the keys one at a time, named in plain words by
 * lib/action-registry, and `applyKeys` writes exactly what was ticked.
 */
export function allKeysOf(m: RoleModule): string[] {
  return [...m.view, ...m.edit, ...(m.approve ?? []), ...(m.delete ?? []), ...(m.extras ?? []).map((x) => x.key)];
}

/**
 * Set this module's keys to exactly `exact`, leaving every other module alone.
 *
 * Unlike `applyModule` this does not round the result to a level. Whatever is
 * ticked is what is stored, and `moduleState` will then report `custom` if no
 * level describes it - which is the honest answer, not a warning.
 */
export function applyKeys(keys: ReadonlySet<string>, m: RoleModule, exact: ReadonlySet<string>): Set<string> {
  const mine = new Set(allKeysOf(m));
  const out = new Set([...keys].filter((k) => !mine.has(k)));
  for (const k of mine) if (exact.has(k)) out.add(k);
  return out;
}

/**
 * The one-time move to the four split-out modules (27 Sep 2026): each new key
 * goes to exactly the roles that could already do that thing through a
 * broader permission, so nobody gains or loses a page or a button.
 */
export const SPLIT_MODULE_GRANTS: { key: string; ifAll?: string[][]; why: string }[] = [
  { key: 'renewals.view', ifAll: [['hrm.view', 'hrm.edit']], why: 'opened Policy renewals through HR' },
  { key: 'renewals.edit', ifAll: [['hrm.edit']], why: 'edited Policy renewals through HR edit' },
  { key: 'amc.view', ifAll: [['complaints.view', 'complaints.edit']], why: 'opened AMC contracts through Complaints' },
  { key: 'amc.edit', ifAll: [['customers.edit'], ['complaints.view', 'complaints.edit']], why: 'edited AMC contracts through Customers edit + Complaints' },
  { key: 'installations.view', ifAll: [['complaints.view', 'complaints.edit']], why: 'opened Installation challans through Complaints' },
  { key: 'installations.edit', ifAll: [['complaints.edit']], why: 'edited Installation challans through Complaints edit' },
  { key: 'assets.view', ifAll: [['hrm.view', 'hrm.edit', 'settings.view', 'settings.edit', 'stock.view', 'stock.adjust']], why: 'opened Assets through HR, Settings or Stock' },
  { key: 'assets.edit', ifAll: [['settings.edit']], why: 'edited Assets through Settings edit' },
];

/** Which split-out keys a role receives: every group in `ifAll` must be met by ANY of its keys. */
export function splitGrantsFor(keys: ReadonlySet<string>): string[] {
  return SPLIT_MODULE_GRANTS
    .filter((g) => (g.ifAll ?? []).every((anyOf) => anyOf.some((k) => keys.has(k))))
    .map((g) => g.key);
}

/**
 * One person's own level on one module (30 Oct 2026, Settings > Operations &
 * approvals): the module's View / Edit / Approve keys become exactly what the
 * level grants. Delete the roles gave is kept only at Edit or above ("can
 * only look" must not keep Delete); their extra switches only while not None.
 */
export function applyPersonalLevel(keys: ReadonlySet<string>, m: RoleModule, level: ModuleLevel): Set<string> {
  const had = moduleState(m, keys);
  const canChange = level === 'edit' || level === 'approve';
  return applyModule(keys, m, {
    level,
    delete: canChange && had.delete,
    extras: Object.fromEntries((m.extras ?? []).map((x) => [x.key, level !== 'none' && had.extras[x.key]])),
  });
}

export const isModuleLevel = (s: string): s is ModuleLevel => (LEVELS as string[]).includes(s);
export const moduleByKey = (key: string) => ROLE_MODULES.find((m) => m.key === key);
