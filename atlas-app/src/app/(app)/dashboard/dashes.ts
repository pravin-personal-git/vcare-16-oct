/**
 * The seven dashboards, in the order of the sidebar and the 1-7 keys, with the
 * question each answers and the shortcuts into its domain (dashboards demo,
 * approved 11 Oct 2026). Shared by the page, the shell and the sidebar.
 */

import { menuHidesDash, type MenuRoutes } from '@/lib/menu-gate';

export type DashKey = 'business' | 'sales' | 'service' | 'stock' | 'accounts' | 'people' | 'my';

export interface DashMeta {
  k: DashKey;
  l: string;
  i: string;
  q: string;
  shortcuts: { l: string; i: string; href: string; money?: boolean; count?: string }[];
}

export const DASHES: DashMeta[] = [
  {
    k: 'business', l: 'Business', i: 'home', q: 'How is the business doing, and what needs me today?',
    shortcuts: [
      { l: 'New invoice', i: 'file', href: '/invoices' },
      { l: 'New quotation', i: 'file', href: '/quotation' },
      { l: 'Record payment', i: 'rupee', href: '/receipts?pay=1', money: true },
      { l: 'Raise complaint', i: 'wrench', href: '/services/complaints?raise=1' },
      { l: 'Add expense', i: 'receipt', href: '/transactions' },
      { l: 'My Desk', i: 'inbox', href: '/my/reminders?tab=waiting', count: 'approvals' },
      { l: 'Reports', i: 'download', href: '/reports/downloads' },
    ],
  },
  {
    k: 'sales', l: 'Sales', i: 'trend', q: 'Are we on target, who is selling, where do deals stop?',
    shortcuts: [
      { l: 'New lead', i: 'user', href: '/crm/leads' },
      { l: 'New quotation', i: 'file', href: '/quotation' },
      { l: 'New sales order', i: 'cart', href: '/sales/orders' },
      { l: 'Leads', i: 'users', href: '/crm/leads', count: 'leads' },
      { l: 'Quotations', i: 'file', href: '/quotation?card=sent', count: 'quotations' },
      { l: 'Orders', i: 'cart', href: '/sales/orders', count: 'orders' },
      { l: 'Offers', i: 'tag', href: '/catalogue' },
    ],
  },
  {
    k: 'service', l: 'Service', i: 'wrench', q: 'Is every complaint moving, and are technicians where they should be?',
    shortcuts: [
      { l: 'Raise complaint', i: 'plus', href: '/services/complaints?raise=1' },
      { l: 'Book a visit', i: 'calendar', href: '/services/visits' },
      { l: 'Jobs board', i: 'grid', href: '/services/board' },
      { l: 'Complaints', i: 'wrench', href: '/services/complaints?card=open', count: 'complaints' },
      { l: 'Supplier dispatch', i: 'truck', href: '/services/dispatch', count: 'dispatch' },
      { l: 'AMC', i: 'shield', href: '/services/amc', count: 'amc' },
    ],
  },
  {
    k: 'stock', l: 'Stock', i: 'box', q: 'What to buy, what is stuck, where the money sits?',
    shortcuts: [
      { l: 'New purchase order', i: 'cart', href: '/purchase/orders' },
      { l: 'Receive goods', i: 'truck', href: '/goods-receipt' },
      { l: 'Stock report', i: 'box', href: '/reports/product-stock' },
      { l: 'Serial units', i: 'pin', href: '/stock-units' },
      { l: 'Van stock', i: 'user', href: '/van-stock' },
      { l: 'Stock health', i: 'sparkle', href: '/reports/stock-health' },
    ],
  },
  {
    k: 'accounts', l: 'Accounts', i: 'card', q: 'Cash today, who owes, what goes out next, GST?',
    shortcuts: [
      { l: 'Record payment', i: 'rupee', href: '/receipts?pay=1', money: true },
      { l: 'Pay supplier', i: 'truck', href: '/purchase/payments' },
      { l: 'Add expense', i: 'receipt', href: '/transactions' },
      { l: 'Bank', i: 'bank', href: '/bank/summary' },
      { l: 'Ledger', i: 'file', href: '/customer/account' },
      { l: 'GST report', i: 'gst', href: '/reports/gst' },
      { l: 'P&L', i: 'sparkle', href: '/reports/profit-loss' },
    ],
  },
  {
    k: 'people', l: 'People', i: 'users', q: 'Who is in, who is away, what does payroll cost?',
    shortcuts: [
      { l: 'Team today', i: 'clock', href: '/attendance/team-today' },
      { l: 'Attendance grid', i: 'grid', href: '/attendance/grid' },
      { l: 'Leave', i: 'calendar', href: '/my/reminders?tab=waiting', count: 'leave' },
      { l: 'Payroll', i: 'rupee', href: '/hrm/payroll' },
      { l: 'Staff', i: 'users', href: '/settings/employees' },
      { l: 'Helpdesk', i: 'inbox', href: '/helpdesk', count: 'helpdesk' },
    ],
  },
  {
    k: 'my', l: 'My day', i: 'user', q: 'Your jobs, your target, your tasks.',
    shortcuts: [
      { l: 'Punch in / out', i: 'clock', href: '/employee/attendance' },
      { l: 'My Desk', i: 'inbox', href: '/my/reminders' },
      { l: 'Apply leave', i: 'calendar', href: '/my/reminders?tab=requests' },
      { l: 'My account', i: 'rupee', href: '/user/account' },
    ],
  },
];

/**
 * Which dashboards a person may open - checked again on the server for the one
 * asked for. Permission is the floor; since 11 Oct 2026 (B1) the menu can then
 * take one away - Settings › Role & User Menu, Dashboard and its rows.
 */
export function allowedDashes(perms: ReadonlySet<string>, excluded: ReadonlySet<string>, menuRoutes?: MenuRoutes): DashKey[] {
  return byPermission(perms, excluded).filter((k) => !menuHidesDash(k, menuRoutes));
}

function byPermission(perms: ReadonlySet<string>, excluded: ReadonlySet<string>): DashKey[] {
  const any = (...p: string[]) => p.some((x) => perms.has(x));
  const full = perms.has('dashboard.view');
  const out: DashKey[] = [];
  if (full) out.push('business');
  if (!excluded.has('Sales') && (full || any('orders.view', 'invoice.view', 'quotation.view'))) out.push('sales');
  if (!excluded.has('Customer Service') && (full || any('complaints.view', 'complaints.edit'))) out.push('service');
  if (!excluded.has('Inventory') && (full || any('stock.view', 'stock.adjust'))) out.push('stock');
  if (!excluded.has('Accounts') && (full || any('accounts.view', 'accounts.edit'))) out.push('accounts');
  if (!excluded.has('HRM') && (full || any('hrm.view', 'hrm.edit', 'attendance.view', 'payroll.view'))) out.push('people');
  out.push('my');
  return out;
}
