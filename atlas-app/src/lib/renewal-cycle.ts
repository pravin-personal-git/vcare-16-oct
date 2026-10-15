/**
 * Renewal cycles and reminder days (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §1).
 *
 * A policy has a next due date and a billing cycle. Marking a due paid moves
 * it on by one cycle - counted from the DUE date, not the day it was paid, so
 * a late payment does not drift the schedule. Reminders fire on the days
 * before the due date the business chose (15, 7 and on the day by default).
 * After the due date it is Overdue and, as decided, nothing more is sent.
 * All dates are India calendar days.
 */
export const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly', months: 1 },
  { key: 'quarterly', label: 'Quarterly', months: 3 },
  { key: 'half_yearly', label: 'Half-yearly', months: 6 },
  { key: 'yearly', label: 'Yearly', months: 12 },
  { key: 'one_time', label: 'One-time', months: 0 },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]['key'];
export const isFrequency = (v: string): v is Frequency => FREQUENCIES.some((f) => f.key === v);

export const DEFAULT_REMINDER_OFFSETS = [15, 7, 0];

const IST_MS = 330 * 60_000;
/** The India calendar day of an instant, as YYYY-MM-DD. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** Whole India days from today to the due date (negative = overdue). */
export function daysUntil(due: Date, now: Date = new Date()): number {
  return dayNumber(istDay(due)) - dayNumber(istDay(now));
}

/**
 * The next due date after `due`, one cycle on. Month-end safe: 31 Jan monthly
 * -> 28/29 Feb -> 31 Mar (the original day is kept when the month has it).
 * Null for a one-time policy.
 */
export function nextDue(due: Date, frequency: Frequency, anchorDay?: number): Date | null {
  const months = FREQUENCIES.find((f) => f.key === frequency)?.months ?? 12;
  if (!months) return null;
  const local = new Date(due.getTime() + IST_MS);
  const day = anchorDay ?? local.getUTCDate();
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(y, m, Math.min(day, lastDay), local.getUTCHours(), local.getUTCMinutes()));
  return new Date(out.getTime() - IST_MS);
}

export type RenewalState = 'upcoming' | 'due_soon' | 'due_today' | 'overdue' | 'not_renewing' | 'closed';

export function renewalState(
  p: { expiryDate: Date; status: string; reminderOffsets: number[] },
  now: Date = new Date(),
): { state: RenewalState; daysLeft: number } {
  const daysLeft = daysUntil(p.expiryDate, now);
  if (p.status === 'closed') return { state: 'closed', daysLeft };
  if (p.status === 'not_renewing') return { state: 'not_renewing', daysLeft };
  const window = Math.max(...offsetsOf(p.reminderOffsets));
  if (daysLeft < 0) return { state: 'overdue', daysLeft };
  if (daysLeft === 0) return { state: 'due_today', daysLeft };
  if (daysLeft <= window) return { state: 'due_soon', daysLeft };
  return { state: 'upcoming', daysLeft };
}

export function offsetsOf(own: number[] | null | undefined, businessDefault: number[] = DEFAULT_REMINDER_OFFSETS): number[] {
  const list = own && own.length ? own : businessDefault;
  return [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
}

/**
 * The reminder that is due now, if any: the smallest offset whose day has
 * arrived and the due date has not passed. Returning the latest one reached
 * means a missed run (the server was quiet on day 15) still sends the day-7
 * reminder rather than nothing - and the dedupe key stops repeats.
 */
export function reminderDue(due: Date, offsets: number[], now: Date = new Date()): number | null {
  const left = daysUntil(due, now);
  if (left < 0) return null;
  const reached = offsets.filter((o) => left <= o);
  return reached.length ? Math.min(...reached) : null;
}

export const reminderLabel = (offset: number) => (offset === 0 ? 'due today' : `due in ${offset} day${offset === 1 ? '' : 's'}`);

/** The WhatsApp / reminder text, from the business template. */
export const DEFAULT_RENEWAL_TEMPLATE =
  'Dear {client}, this is a reminder from {business} that your {policy}{number} is due for renewal on {due_date}{amount}. Please let us know to renew it on time. Thank you.';

export function fillTemplate(template: string, v: {
  client?: string | null; policy: string; number?: string | null; dueDate: Date; amountPaise?: number | null; business: string; daysLeft?: number;
}): string {
  const due = v.dueDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  const amount = v.amountPaise ? ` (₹${(v.amountPaise / 100).toLocaleString('en-IN')})` : '';
  return template
    .replaceAll('{client}', v.client?.trim() || 'Sir/Madam')
    .replaceAll('{policy}', v.policy)
    .replaceAll('{number}', v.number ? ` (${v.number})` : '')
    .replaceAll('{due_date}', due)
    .replaceAll('{amount}', amount)
    .replaceAll('{business}', v.business)
    .replaceAll('{days_left}', String(v.daysLeft ?? ''));
}
