import { daysBetween } from './expiry';
/**
 * Party row shape and derived-metric rules.
 *
 * No database import and no `server-only` marker - the list screen filters in
 * the browser while the page computes the same summary on the server. One
 * definition, both sides. (The Products module got this wrong first time.)
 *
 * Spec: 03-customers.md §2
 */

export interface PartyRow {
  id: string;
  isCustomer: boolean;
  isSupplier: boolean;
  payablePaise: number;
  supplierType: string | null;
  partyCode: string;
  displayName: string;
  companyName: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  addressLine1: string | null;
  customerTypeName: string | null;
  customerSince: Date;
  managerName: string | null;
  rewardPoints: number;
  currentBalancePaise: number;
  creditLimitPaise: number;
  creditLimitDays: number;
  dueDate: Date | null;
  lastPurchaseAt: Date | null;
  lastCommunicationAt: Date | null;
  birthday: Date | null;
  gstin: string | null;
  status: string;
  createdAt: Date;
}

/**
 * The subset of a party the metric rules actually read.
 *
 * Every function below takes this rather than the full `PartyRow`, so the same
 * rules can be applied to a narrow query over EVERY party without loading the
 * names, addresses and GSTINs the grid needs. `PartyRow` satisfies it
 * structurally, so nothing that already passes a full row has to change.
 *
 * This exists because the list screens cap at 500 rows and their KPI tiles were
 * computed from that page - a store with 4,743 customers reported 500, which
 * reads as missing data. The cap stays for payload reasons; the numbers are now
 * worked out over the whole set, through these same rules rather than a second
 * copy of them in SQL.
 */
export interface PartyMetricsInput {
  isCustomer: boolean;
  isSupplier: boolean;
  payablePaise: number;
  currentBalancePaise: number;
  creditLimitPaise: number;
  creditLimitDays: number;
  dueDate: Date | null;
  lastPurchaseAt: Date | null;
  lastCommunicationAt: Date | null;
  birthday: Date | null;
}

export const NO_ORDER_DAYS = 30;
export const NO_COMM_DAYS = 30;

export type PartyFilter =
  | 'total_due' | 'due_date_over' | 'cr_days_over'
  | 'no_order_30' | 'no_comm_30' | 'birthday_week' | 'crossed_limit'
  | 'payable' | 'both_roles';

/** They owe us minus what we owe them. Only meaningful for a party in both roles. */
export function netPositionPaise(p: PartyMetricsInput): number {
  return p.currentBalancePaise - p.payablePaise;
}

/**
 * Always relative to the caller's `now`, never to Date.now().
 *
 * These functions took a `now` argument but the helper ignored it and read the
 * wall clock, so results drifted between the test's fixed timestamp and real
 * time - a test that passed in the morning and failed in the evening.
 */
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000);

/** Days since the invoice due date, or null if nothing is due. */
export function daysOverdue(c: PartyMetricsInput, now = new Date()): number | null {
  if (!c.dueDate || c.currentBalancePaise <= 0) return null;
  // Calendar days in India - overdue from the day after it fell due (10 Oct 2026).
  const diff = daysBetween(c.dueDate, now);
  return diff > 0 ? diff : null;
}

/**
 * Birthday within the next 7 days, ignoring year - so it works across a
 * year boundary (a 2 January birthday counts on 30 December).
 */
export function birthdayThisWeek(c: PartyMetricsInput, now = new Date()): boolean {
  if (!c.birthday) return false;
  const dayOfYear = (d: Date) =>
    Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const diff = (dayOfYear(c.birthday) - dayOfYear(now) + 365) % 365;
  return diff <= 7;
}

export function matchesFilter(c: PartyMetricsInput, f: PartyFilter, now = new Date()): boolean {
  switch (f) {
    case 'total_due':     return c.currentBalancePaise > 0;
    case 'due_date_over': return daysOverdue(c, now) !== null;
    case 'cr_days_over': {
      const over = daysOverdue(c, now);
      return over !== null && over > c.creditLimitDays;
    }
    case 'crossed_limit':
      return c.creditLimitPaise > 0 && c.currentBalancePaise > c.creditLimitPaise;
    case 'no_order_30':
      return !c.lastPurchaseAt || c.lastPurchaseAt < daysAgo(NO_ORDER_DAYS, now);
    case 'no_comm_30':
      return !c.lastCommunicationAt || c.lastCommunicationAt < daysAgo(NO_COMM_DAYS, now);
    case 'birthday_week': return birthdayThisWeek(c, now);
    case 'payable':       return c.payablePaise > 0;
    case 'both_roles':    return c.isCustomer && c.isSupplier;
  }
}

export function summarise(rows: PartyMetricsInput[], now = new Date()) {
  const count = (f: PartyFilter) => rows.filter((r) => matchesFilter(r, f, now)).length;
  return {
    total_due: count('total_due'),
    due_date_over: count('due_date_over'),
    cr_days_over: count('cr_days_over'),
    crossed_limit: count('crossed_limit'),
    no_order_30: count('no_order_30'),
    no_comm_30: count('no_comm_30'),
    birthday_week: count('birthday_week'),
    payable: count('payable'),
    both_roles: count('both_roles'),
    total_due_paise: rows.reduce((n, r) => n + Math.max(0, r.currentBalancePaise), 0),
    total_payable_paise: rows.reduce((n, r) => n + Math.max(0, r.payablePaise), 0),
  };
}
