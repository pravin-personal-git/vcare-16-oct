import type { IconName } from '@/components/ui/Icon';
import type { BadgeTone } from '@/components/ui/Layout';

/**
 * My Desk colour map (30 Oct 2026). 37 approval types and 8 notification kinds
 * were one grey chip each; an admin with 250 waiting could not tell field work
 * from money at a glance. Every type now falls in one of six groups, each with
 * one colour (a Badge tone, so light and dark both work) and one icon.
 * A type missing here lands in "Other" - add it when a new type is registered
 * in lib/approval-rules.
 */
export interface DeskCategory { key: string; label: string; icon: IconName; tone: BadgeTone }

export const DESK_CATEGORIES: DeskCategory[] = [
  { key: 'field', label: 'Field jobs', icon: 'wrench', tone: 'info' },
  { key: 'challan', label: 'Challans & stock', icon: 'truck', tone: 'navy' },
  { key: 'exception', label: 'Exceptions', icon: 'alert-triangle', tone: 'danger' },
  { key: 'sales', label: 'Sales & billing', icon: 'receipt', tone: 'brand' },
  { key: 'money', label: 'Money & purchase', icon: 'credit-card', tone: 'success' },
  { key: 'people', label: 'People & leave', icon: 'users', tone: 'warning' },
  { key: 'other', label: 'Other', icon: 'help-circle', tone: 'neutral' },
];

const TYPE_TO: Record<string, string> = {
  job_close: 'field', job_challan: 'field',
  installation_challan: 'challan', repair_challan: 'challan', van_writeoff: 'challan',
  site_override: 'exception', warranty_void: 'exception', period_reopen: 'exception', price_change: 'exception', credit_limit: 'exception',
  sales_order: 'sales', quotation_send: 'sales', invoice_issue: 'sales', invoice_cancel: 'sales', invoice_edit: 'sales',
  sales_return: 'sales', order_cancel_paid: 'sales', credit_note: 'sales',
  purchase_bill: 'money', purchase_order: 'money', expense: 'money', refund: 'money', receipt_reverse: 'money',
  supplier_payment: 'money', supplier_payment_reverse: 'money', debit_note: 'money',
  leave: 'people', wfh: 'people', comp_off: 'people', leave_allocation: 'people', reimbursement: 'people',
  leave_encashment: 'people', asset_request: 'people', resignation: 'people', staff_loan: 'people',
  payroll_process: 'people', payroll_paid: 'people', payroll_revert: 'people',
};

export const categoryOf = (type: string): DeskCategory =>
  DESK_CATEGORIES.find((c) => c.key === TYPE_TO[type]) ?? DESK_CATEGORIES[DESK_CATEGORIES.length - 1];

/** Notification kinds (server/notify NotificationKind) - their own colours, same palette. */
export const NOTE_KINDS: Record<string, { label: string; icon: IconName; tone: BadgeTone }> = {
  approval_waiting: { label: 'Approvals waiting on me', icon: 'check-circle', tone: 'warning' },
  approval_decided: { label: 'Decisions on my requests', icon: 'send', tone: 'success' },
  escalation: { label: 'Escalations', icon: 'alert-triangle', tone: 'danger' },
  renewal: { label: 'Renewals & due dates', icon: 'calendar', tone: 'navy' },
  reminder: { label: 'My reminders', icon: 'clock', tone: 'brand' },
  system: { label: 'Morning summary', icon: 'sun', tone: 'neutral' },
  job: { label: 'Field jobs', icon: 'wrench', tone: 'info' },
  shop_request: { label: 'Online shop requests', icon: 'shopping-cart', tone: 'brand' },
};

/** How long it has waited, as a colour: over 7 days red, over 2 days amber. */
export const ageTone = (iso: string): 'danger' | 'warning' | null => {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  return days > 7 ? 'danger' : days > 2 ? 'warning' : null;
};
