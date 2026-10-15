/**
 * EVERY BUTTON, IN PLAIN WORDS (F-01, 10 Oct 2026).
 *
 * Pravin: "har button ko specific user role ko hi de paye aur dikhayein."
 *
 * The permission keys already existed and the buttons already checked them.
 * What did not exist was a way for the person setting up a role to SEE the
 * buttons. The Roles editor offered four levels per module - No access /
 * View / Edit / Approve - and a level is a bundle: Edit on Invoices means
 * create AND change AND the cost trail, together, because that is what the
 * bundle says. An owner who wants Anita to raise invoices but never to see
 * what the goods cost had no way to say so; the editor would show "custom"
 * if the database already said it, and offered no way to get there.
 *
 * So this file names each key as the BUTTON it unlocks and says where that
 * button is. The levels stay as presets - most roles are one of four shapes -
 * and underneath them every action is a tick of its own.
 *
 * TWO RULES THIS FILE IS HELD TO (lib/__tests__/action-registry.test.ts):
 *
 *   1. Every permission a role can hold has a row here. A key with no plain
 *      words cannot be granted deliberately by anybody who did not write it.
 *   2. Every row's key is reachable through lib/role-modules, and is read
 *      somewhere in the code. A permission nothing checks is a tick that does
 *      nothing - which was the last thing left open on F-01.
 *
 * `where` is the path a person would take to find the button, not a URL: this
 * text is read by whoever is deciding what Anita may do, and they do not
 * think in routes.
 */

export interface ActionRow {
  /** The permission key, exactly as the code checks it. */
  key: string;
  /** The button or the capability, named the way the screen names it. */
  label: string;
  /** Where to find it. Menu path, not a URL. */
  where: string;
  /** Why it is separate from the rest of its module. Shown on hover. */
  hint?: string;
  /**
   * Money, somebody's pay, or a decision that cannot be taken back. Drawn with
   * a mark in the editor, so a careless tick is at least a visible one.
   */
  sensitive?: boolean;
}

export const ACTIONS: ActionRow[] = [
  // ------------------------------------------------------------------ Sales
  { key: 'leads.view', label: 'See enquiries', where: 'Sales > Leads' },
  { key: 'leads.create', label: 'Add an enquiry', where: 'Sales > Leads > New lead' },
  { key: 'leads.edit', label: 'Change an enquiry and log follow-ups', where: 'Sales > Leads > open one' },

  { key: 'customers.view', label: 'See customers', where: 'Sales > Customers' },
  { key: 'customers.create', label: 'Add a customer', where: 'Sales > Customers > New customer' },
  { key: 'customers.edit', label: 'Change a customer, including the credit limit', where: 'Sales > Customers > open one' },

  { key: 'quotation.view', label: 'See quotations', where: 'Sales > Quotation' },
  { key: 'quotation.create', label: 'Make a quotation', where: 'Sales > Quotation > New quotation' },
  { key: 'quotation.edit', label: 'Change a quotation and send it', where: 'Sales > Quotation > open one' },
  {
    key: 'quotation.approve', label: 'Approve a quotation that broke a rule',
    where: 'Sales > Quotation > open one > Approve',
    hint: 'A discount or a margin outside the Approval Rules waits for this.', sensitive: true,
  },
  { key: 'quotation.delete', label: 'Delete a quotation', where: 'Sales > Quotation > open one > Delete', sensitive: true },

  { key: 'orders.view', label: 'See sales orders', where: 'Sales > Sales Order' },
  { key: 'orders.create', label: 'Make a sales order', where: 'Sales > Sales Order > New order' },
  { key: 'orders.edit', label: 'Change an order and dispatch it', where: 'Sales > Sales Order > open one' },
  {
    key: 'orders.approve', label: 'Approve or cancel an order',
    where: 'Sales > Sales Order > open one > Approve / Cancel',
    hint: 'Cancelling an order money has been taken against needs this.', sensitive: true,
  },

  { key: 'invoice.view', label: 'See invoices and receipts', where: 'Sales > Invoice' },
  { key: 'invoice.create', label: 'Raise an invoice', where: 'Sales > Invoice > New invoice', sensitive: true },
  { key: 'invoice.edit', label: 'Change an invoice and take money against it', where: 'Sales > Invoice > open one', sensitive: true },
  {
    key: 'invoice.approve', label: 'Issue or cancel an invoice',
    where: 'Sales > Invoice > open one > Issue / Cancel',
    hint: 'Issuing fixes the number on it; cancelling reverses the money.', sensitive: true,
  },
  {
    key: 'invoice.costTrail', label: 'See what the goods on an invoice cost us',
    where: 'Sales > Invoice > open one > a line > Cost trail',
    hint: 'The margin on this customer. Whoever chases payment does not need it.',
    sensitive: true,
  },

  {
    key: 'calls.view', label: 'See the calls of the whole team',
    where: 'Sales > Call Logs',
    hint: 'Own calls are always visible to everybody. This is the report on other people.',
  },
  { key: 'calls.manage', label: 'Manage which phones sync calls', where: 'Sales > Call Logs > Manage phones' },
  {
    key: 'devices.pair', label: 'Pair and unpair an employee phone',
    where: 'Settings > Devices',
    hint: 'A paired phone can mark attendance and see jobs, so this is handed out sparingly.',
    sensitive: true,
  },

  // --------------------------------------------------------- Returns & money
  { key: 'returns.view', label: 'See sales returns and credit notes', where: 'Returns & Refunds' },
  { key: 'returns.edit', label: 'Take goods back (sales return)', where: 'Returns & Refunds > Sales Return' },
  {
    key: 'returns.credit', label: 'Give the money back (credit note)',
    where: 'Returns & Refunds > Credit Notes',
    hint: 'Taking goods back and giving money back are two authorities. The counter does one; a manager does the other.',
    sensitive: true,
  },

  { key: 'accounts.view', label: 'See the books - ledgers, P&L, GST, bank', where: 'Accounts' },
  {
    key: 'accounts.edit', label: 'Record money in and out, and close a period',
    where: 'Office Expenses, and Accounts > Bank Statement',
    sensitive: true,
  },

  // ------------------------------------------------------- Stock & purchase
  { key: 'products.view', label: 'See products and prices', where: 'Products' },
  { key: 'products.edit', label: 'Add and change products and prices', where: 'Products > New product' },

  { key: 'stock.view', label: 'See stock, dispatch and manufacturing', where: 'Inventory' },
  {
    key: 'stock.adjust', label: 'Change a stock figure by hand',
    where: 'Inventory > Stock > Adjust',
    hint: 'The one place a quantity can move without a document behind it.',
    sensitive: true,
  },

  { key: 'purchase.view', label: 'See what was bought and what it cost', where: 'Purchase' },
  {
    key: 'purchase.edit', label: 'Enter a purchase order, a bill, or goods received',
    where: 'Purchase > New',
    hint: 'A bill puts stock in and creates a debt to the supplier.',
  },
  {
    key: 'purchase.approve', label: 'Approve a purchase order or bill',
    where: 'Purchase > open one > Approve', sensitive: true,
  },
  {
    key: 'purchase.pay', label: 'Pay a supplier',
    where: 'Purchase > Supplier Payments',
    hint: 'Whoever receives the goods should not also be the one who pays for them.',
    sensitive: true,
  },

  // ---------------------------------------------------------------- Service
  { key: 'complaints.view', label: 'See complaints and visits', where: 'Services' },
  {
    key: 'complaints.edit', label: 'Raise, assign and resolve a complaint',
    where: 'Services > Complaints > open one',
    hint: 'One authority: raising, assigning a technician, scheduling a visit, raising a repair challan.',
  },
  {
    key: 'complaints.approve', label: 'Approve parts issued and job closes',
    where: 'Services > Complaints > open one > Approve',
    hint: 'Lets somebody other than the owner run the parts desk.', sensitive: true,
  },
  { key: 'installations.view', label: 'See installation challans', where: 'Services > Installation Challan' },
  { key: 'installations.edit', label: 'Raise an installation challan', where: 'Services > Installation Challan > New' },
  { key: 'amc.view', label: 'See AMC contracts', where: 'Services > AMC' },
  { key: 'amc.edit', label: 'Make and bill an AMC contract', where: 'Services > AMC > New contract' },

  // ----------------------------------------------------------------- People
  {
    key: 'attendance.view', label: 'See the attendance of everybody',
    where: 'HRM > Attendance',
    hint: 'Own attendance is always visible. This is other people.',
  },
  {
    key: 'attendance.edit', label: 'Correct an attendance record',
    where: 'HRM > Attendance > open a day',
    hint: 'It changes a number that becomes a wage. Many should see attendance; very few should change it afterwards.',
    sensitive: true,
  },
  {
    key: 'attendance.locate', label: 'See where somebody went (location trail)',
    where: 'HRM > Attendance > open a day > Trail',
    hint: 'The most invasive thing Atlas holds. Separate on purpose: somebody can be allowed to see that Rahul worked 08:12 to 19:40 without seeing everywhere he went.',
    sensitive: true,
  },

  { key: 'hrm.view', label: 'See employees, leave and the org chart', where: 'HRM' },
  { key: 'hrm.edit', label: 'Add and change employees, leave and hiring', where: 'HRM > Employee > New' },

  { key: 'renewals.view', label: 'See policy renewals', where: 'HRM > Renewal' },
  { key: 'renewals.edit', label: 'Add and change a policy', where: 'HRM > Renewal > New policy' },

  {
    key: 'payroll.view', label: 'See salaries, payslips and PF, ESIC and TDS',
    where: 'HRM > Payroll',
    hint: 'The pay of everybody, not a gross figure on an HR screen.', sensitive: true,
  },
  {
    key: 'payroll.process', label: 'Run a payroll month, pay it, and revert it',
    where: 'HRM > Payroll > Process',
    hint: 'Locks pay for the month and posts it to the books.', sensitive: true,
  },
  {
    key: 'payroll.configure', label: 'Set up salary structures and statutory rates',
    where: 'HRM > Payroll > Salary Structure',
    hint: 'Touched a few times a year. Not everybody who runs payroll should also change what it is made of.',
    sensitive: true,
  },

  { key: 'helpdesk.view', label: 'See every staff ticket', where: 'HRM > Helpdesk', hint: 'Raising your own ticket needs no permission.' },
  { key: 'helpdesk.edit', label: 'Answer and close staff tickets', where: 'HRM > Helpdesk > open one' },

  { key: 'assets.view', label: 'See company assets and who holds what', where: 'HRM > Assets' },
  { key: 'assets.edit', label: 'Issue and take back an asset', where: 'HRM > Assets > Issue' },

  // --------------------------------------------------------- Administration
  { key: 'dashboard.view', label: 'See the business figures on the dashboard', where: 'Dashboard' },
  {
    key: 'tasks.edit', label: 'Assign and change the tasks of other people',
    where: 'Task Manager',
    hint: 'Own tasks are always allowed.',
  },

  { key: 'users.view', label: 'See who can sign in', where: 'Settings > Users' },
  {
    key: 'users.edit', label: 'Add a user, change a role, reset a password',
    where: 'Settings > Users > New user',
    hint: 'Whoever holds this can give themselves anything else.', sensitive: true,
  },
  {
    // Vcare, 9 Oct 2026 - see server/password-copy.ts.
    key: 'users.viewPasswords', label: "See a user's current password",
    where: 'Settings > Users > Reset password',
    hint: 'Asks for their own password first, and every look is logged.', sensitive: true,
  },

  { key: 'settings.view', label: 'See the business setup', where: 'Settings' },
  {
    key: 'settings.edit', label: 'Change the business setup and the approval rules',
    where: 'Settings > any screen',
    hint: 'Includes who has to approve what, which is the control behind every other control.',
    sensitive: true,
  },
];

const BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));

export const actionByKey = (key: string): ActionRow | null => BY_KEY.get(key) ?? null;

/** Plain words for a key, falling back to the key so a screen never shows blank. */
export const actionLabel = (key: string): string => BY_KEY.get(key)?.label ?? key;
