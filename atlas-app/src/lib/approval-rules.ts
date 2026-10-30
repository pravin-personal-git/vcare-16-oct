/**
 * Approval rules - what needs approval, from whom, and who skips it
 * (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §4). Pure logic, shared by
 * the server (deciding) and the settings screen (explaining).
 *
 * Every module that can need a sign-off registers its type here, so a new
 * module joins the rules screen and My Reminders & Requests without either
 * being touched.
 */

export interface RequestType {
  key: string;
  label: string;
  group: 'People' | 'Sales' | 'Purchase & money' | 'Service';
  /** Carries an amount, so thresholds apply. */
  hasAmount: boolean;
  /** How it routed before rules existed: the requester's reporting line, or a role chain. */
  legacy: 'hierarchy' | 'role' | 'none';
  /** Where the record opens. */
  href: (id: string) => string;
  /** Discount % and margin % can also be conditions (quotation, invoice). */
  hasPricing?: boolean;
}

export const REQUEST_TYPES: RequestType[] = [
  // Leave, WFH and comp-off are decided on the Monthly Grid; extra allocation on
  // Leave types. Until 6 Oct 2026 all four pointed at /hrm/leave, which never existed.
  { key: 'leave', label: 'Leave request', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/attendance/grid?open=${id}` },
  { key: 'wfh', label: 'Work from home', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/attendance/grid?open=${id}` },
  /*
    Comp-off is decided on Leave types, not on the Monthly Grid (8 Oct 2026).
    Its entityId is a `CompOffEntry`, which the grid does not draw at all, so
    this link arrived somewhere the record could not be - a wrong screen, not
    just an imprecise one.
  */
  { key: 'comp_off', label: 'Comp-off', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/holiday/leave-types?open=${id}` },
  { key: 'leave_allocation', label: 'Extra leave allocation', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/holiday/leave-types?open=${id}` },
  { key: 'reimbursement', label: 'Reimbursement claim', group: 'People', hasAmount: true, legacy: 'hierarchy', href: (id) => `/hrm/payroll?open=${id}` },
  { key: 'leave_encashment', label: 'Leave encashment', group: 'People', hasAmount: true, legacy: 'hierarchy', href: (id) => `/hrm/payroll?open=${id}` },
  { key: 'asset_request', label: 'Asset request', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/assets?open=${id}` },
  { key: 'resignation', label: 'Resignation', group: 'People', hasAmount: false, legacy: 'hierarchy', href: (id) => `/hrm/offboarding?open=${id}` },
  { key: 'sales_order', label: 'Sales order', group: 'Sales', hasAmount: true, legacy: 'role', href: (id) => `/sales/orders/${id}` },
  // 5 Oct 2026: both move money, so both may now wait for a sign-off before
  // they take effect - the credit note before it is issued, the bill before
  // it is posted (stock in, supplier owed). No rule saved = as before.
  { key: 'credit_note', label: 'Credit note', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/credit-notes/${id}` },
  { key: 'purchase_bill', label: 'Purchase bill', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/purchase/bills/${id}` },
  // Held actions (5 Oct 2026, server/approval-actions): the action waits, with
  // its details saved, and runs once approved. No rule saved = as before.
  { key: 'quotation_send', label: 'Quotation - send to customer', group: 'Sales', hasAmount: true, hasPricing: true, legacy: 'none', href: (id) => `/quotation/${id}` },
  { key: 'invoice_issue', label: 'Invoice - issue', group: 'Sales', hasAmount: true, hasPricing: true, legacy: 'none', href: (id) => `/invoices/${id}` },
  { key: 'invoice_cancel', label: 'Invoice - cancel', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/invoices/${id}` },
  { key: 'invoice_edit', label: 'Invoice - change after issue', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/invoices/${id}` },
  { key: 'sales_return', label: 'Sales return - take goods back', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/sales-return/${id}` },
  { key: 'order_cancel_paid', label: 'Sales order - cancel after payment', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/sales/orders/${id}` },
  { key: 'credit_limit', label: 'Customer credit limit - change', group: 'Sales', hasAmount: true, legacy: 'none', href: (id) => `/customers/${id}` },
  { key: 'price_change', label: 'Product price - change', group: 'Sales', hasAmount: false, legacy: 'none', href: (id) => `/products?open=${id}` },
  { key: 'refund', label: 'Refund to a customer', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/credit-notes/${id}` },
  { key: 'receipt_reverse', label: 'Receipt - reverse or bounce', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/receipts?open=${id}` },
  { key: 'supplier_payment', label: 'Supplier payment', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/purchase/payables?open=${id}` },
  { key: 'supplier_payment_reverse', label: 'Supplier payment - reverse', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/purchase/payments/${id}` },
  { key: 'debit_note', label: 'Debit note (purchase return)', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/purchase-return?open=${id}` },
  { key: 'van_writeoff', label: 'Van stock shortfall - write off', group: 'Purchase & money', hasAmount: false, legacy: 'none', href: (id) => `/van-stock?open=${id}` },
  { key: 'period_reopen', label: 'Reopen a closed month', group: 'Purchase & money', hasAmount: false, legacy: 'none', href: (id) => `/settings/period-lock?open=${id}` },
  { key: 'payroll_process', label: 'Payroll - process a run', group: 'People', hasAmount: true, legacy: 'none', href: (id) => `/hrm/payroll/${id}` },
  { key: 'payroll_paid', label: 'Payroll - mark paid', group: 'People', hasAmount: true, legacy: 'none', href: (id) => `/hrm/payroll/${id}` },
  { key: 'payroll_revert', label: 'Payroll - take a processed run back', group: 'People', hasAmount: true, legacy: 'none', href: (id) => `/hrm/payroll/${id}` },
  { key: 'staff_loan', label: 'Staff loan or advance', group: 'People', hasAmount: true, legacy: 'none', href: (id) => `/hrm/loans?open=${id}` },
  { key: 'purchase_order', label: 'Purchase order', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/purchase/orders?open=${id}` },
  { key: 'expense', label: 'Expense / payment voucher', group: 'Purchase & money', hasAmount: true, legacy: 'none', href: (id) => `/transactions?open=${id}` },
  { key: 'installation_challan', label: 'Installation challan', group: 'Service', hasAmount: false, legacy: 'none', href: (id) => `/services/installations/${id}` },
  { key: 'repair_challan', label: 'Repair challan', group: 'Service', hasAmount: false, legacy: 'none', href: (id) => `/services/repairs?open=${id}` },
  // Workflow slice 3: a technician starting work although the location check failed.
  { key: 'site_override', label: 'Location override (field job)', group: 'Service', hasAmount: false, legacy: 'hierarchy', href: (id) => `/services/board?open=${id}` },
  // Workflow slice 4: parts for a field job, before the store issues them.
  { key: 'job_challan', label: 'Job challan (parts)', group: 'Service', hasAmount: true, legacy: 'none', href: (id) => `/goods-dispatch/job-parts?open=${id}` },
  // Workflow slice 6: a resolved job waiting to be closed.
  { key: 'job_close', label: 'Close a field job', group: 'Service', hasAmount: false, legacy: 'none', href: (id) => `/services/complaints/${id}` },
  // Stage 2 of the repair flow (10 Oct 2026): a manager voids one item's warranty.
  // The id is the ITEM's; that route finds its complaint and goes there.
  { key: 'warranty_void', label: 'Void a warranty (service item)', group: 'Service', hasAmount: false, legacy: 'none', href: (id) => `/services/complaints/item/${id}` },
];

/**
 * WHY EVERY `href` CARRIES THE ID (Vcare, 7 Oct 2026).
 *
 * Pravin pressed "Open" on an expense voucher in My Desk and landed on the
 * whole transactions list, with his own voucher somewhere in it. His words:
 * "which is misleading". He was right - AGENTS.md has said since September
 * that a document link must never land on a list page, and these were the
 * exception nobody had looked at.
 *
 * Three targets have a real detail page and now link straight to it. The rest
 * are list screens, and they take `?open=<id>`, which is READ IN ONE PLACE:
 * `components/ui/OpenTarget`, mounted in the app shell, finds the row carrying
 * `data-row-id` and scrolls to it. DataGrid puts that attribute on every row it
 * draws, so eleven of these screens needed no change; six more that build their
 * own rows had the attribute added by hand.
 *
 * ALL OF THEM LAND NOW (8 Oct 2026). The last four took four different
 * answers, and the differences are the point:
 *
 *   leave, WFH  - the Monthly Grid already lists waiting requests; the row
 *                 simply had no id on it. One attribute.
 *   comp-off    - was pointing at the Monthly Grid, which does not draw a
 *                 `CompOffEntry` at all. That was a wrong screen, not an
 *                 imprecise one. It goes to Leave types, where the request is.
 *   period      - the entityId is `<financial year>-<month index>`, not a
 *                 row id, so the month row carries exactly that string.
 *   van         - a HELD action: the write-off does not exist yet, which is
 *                 the point of holding it, so no `?open=` could ever find it.
 *                 The request carries its own `href` to the van instead, via
 *                 `ActionSpec.href`. Any future held action can do the same.
 */
export const requestType = (key: string) => REQUEST_TYPES.find((t) => t.key === key);

export type ApproverKind = 'manager' | 'manager2' | 'role' | 'user' | 'owner';
export const APPROVER_KINDS: { key: ApproverKind; label: string }[] = [
  { key: 'manager', label: "Requester's manager" },
  { key: 'manager2', label: "Manager's manager" },
  { key: 'role', label: 'Anyone with a role' },
  { key: 'user', label: 'A named person' },
  { key: 'owner', label: 'Owner / admins' },
];

export interface RuleLevel { level: number; approverKind: ApproverKind; roleId: string | null; userId: string | null; minAmountPaise: number | null }
export interface Rule {
  needsApproval: boolean;
  thresholdPaise: number | null;
  /** Approval when the discount is above this %. Pricing types only. */
  maxDiscountPct?: number | null;
  /** Approval when the margin is below this %. Pricing types only. */
  minMarginPct?: number | null;
  skipRoleIds: string[];
  skipUserIds: string[];
  levels: RuleLevel[];
  nudgeHours: number;
  escalateHours: number;
  escalateTo: 'next_level' | 'owner';
}

export interface Requester {
  userId: string; roleIds: string[]; amountPaise: number | null;
  /** Overall discount and margin of the document, when the type has pricing. Null = unknown. */
  discountPct?: number | null;
  marginPct?: number | null;
}

/**
 * Does this request need approval under the rule, and which levels apply?
 * `auto` carries the reason shown on the record ("approved automatically -
 * below ₹25,000").
 */
export function evaluateRule(rule: Rule, r: Requester): { auto: true; reason: string } | { auto: false; levels: RuleLevel[] } {
  if (!rule.needsApproval) return { auto: true, reason: 'No approval needed for this type' };
  if (rule.skipUserIds.includes(r.userId)) return { auto: true, reason: 'Allowed to skip approval' };
  if (r.roleIds.some((id) => rule.skipRoleIds.includes(id))) return { auto: true, reason: 'Their role skips approval' };
  const maxDisc = rule.maxDiscountPct ?? null;
  const minMargin = rule.minMarginPct ?? null;
  if (maxDisc !== null || minMargin !== null) {
    // Any one condition is enough: a big amount, a deep discount or a thin
    // margin. An unknown margin (no cost on record) never triggers by itself.
    const overAmount = rule.thresholdPaise !== null && r.amountPaise !== null && r.amountPaise >= rule.thresholdPaise;
    const overDiscount = maxDisc !== null && r.discountPct != null && r.discountPct > maxDisc;
    const underMargin = minMargin !== null && r.marginPct != null && r.marginPct < minMargin;
    if (!overAmount && !overDiscount && !underMargin) return { auto: true, reason: 'Within the amount, discount and margin limits' };
  } else if (rule.thresholdPaise !== null && r.amountPaise !== null && r.amountPaise < rule.thresholdPaise) {
    return { auto: true, reason: `Below ₹${(rule.thresholdPaise / 100).toLocaleString('en-IN')}` };
  }
  const levels = applicableLevels(rule, r.amountPaise);
  if (!levels.length) return { auto: true, reason: 'No approver levels set' };
  return { auto: false, levels };
}

/** Levels in order, keeping those whose minimum amount the request reaches. */
export function applicableLevels(rule: Pick<Rule, 'levels'>, amountPaise: number | null): RuleLevel[] {
  return [...rule.levels]
    .sort((a, b) => a.level - b.level)
    .filter((l) => l.minAmountPaise === null || (amountPaise !== null && amountPaise >= l.minAmountPaise));
}

/** The three one-click starting points (§4 "Presets"). */
export function presetRule(preset: 'strict' | 'balanced' | 'relaxed', t: RequestType): Omit<Rule, 'skipRoleIds' | 'skipUserIds'> {
  const base = { nudgeHours: 24, escalateHours: 48, escalateTo: 'owner' as const };
  if (preset === 'strict') {
    return { ...base, needsApproval: true, thresholdPaise: null, levels: [{ level: 1, approverKind: 'owner', roleId: null, userId: null, minAmountPaise: null }] };
  }
  if (preset === 'relaxed') {
    return t.hasAmount
      ? { ...base, needsApproval: true, thresholdPaise: 100_000_00, levels: [{ level: 1, approverKind: 'owner', roleId: null, userId: null, minAmountPaise: null }] }
      : { ...base, needsApproval: t.group === 'People', thresholdPaise: null, levels: [{ level: 1, approverKind: 'manager', roleId: null, userId: null, minAmountPaise: null }] };
  }
  // balanced: people go to their manager; money above ₹25k to the manager, above ₹1 lakh also the owner.
  if (t.hasAmount) {
    return {
      ...base, needsApproval: true, thresholdPaise: 25_000_00,
      levels: [
        { level: 1, approverKind: t.group === 'People' ? 'manager' : 'owner', roleId: null, userId: null, minAmountPaise: null },
        ...(t.group === 'People' ? [{ level: 2, approverKind: 'owner' as const, roleId: null, userId: null, minAmountPaise: 100_000_00 }] : []),
      ],
    };
  }
  return { ...base, needsApproval: true, thresholdPaise: null, levels: [{ level: 1, approverKind: t.group === 'People' ? 'manager' : 'owner', roleId: null, userId: null, minAmountPaise: null }] };
}

/**
 * May this person decide the step in front of them, and if so, is it an
 * owner stepping past the normal route?
 *
 * Until 4 Oct 2026 the self-approval guard was ANDed in front of the owner
 * check, so an owner opening their own sales order was refused - and told the
 * step "waits on" the level-1 approver, which was not the reason. Now:
 *
 * - An owner (a role with `settings.edit`) is never stuck. When they decide
 *   something they raised, or a level that is not theirs, it goes through as
 *   an override and is marked so (`override`).
 * - Everybody else keeps the guard: not your own request, and only the people
 *   this level names. A one-person level that names the requester is allowed,
 *   as before - nobody else could ever say yes.
 */
export type DecideVerdict =
  | { ok: true; override: 'self' | 'skipped' | null }
  | { ok: false; reason: 'self' | 'not_approver' };

export function decideVerdict(i: {
  deciderId: string; requesterId: string; approvers: string[]; owners: string[];
}): DecideVerdict {
  const self = i.deciderId === i.requesterId;
  const soleApprover = i.approvers.length === 1 && i.approvers[0] === i.deciderId;
  const isApprover = i.approvers.includes(i.deciderId);
  if (i.owners.includes(i.deciderId)) {
    if (self) return { ok: true, override: 'self' };
    return { ok: true, override: isApprover ? null : 'skipped' };
  }
  if (self && !soleApprover) return { ok: false, reason: 'self' };
  if (!isApprover) return { ok: false, reason: 'not_approver' };
  return { ok: true, override: null };
}

/** The line written on the request (and so the audit log) when an owner overrides. */
export function overrideNote(override: 'self' | 'skipped', decision: 'approved' | 'rejected', deciderName: string, level: number, waitingOn: string[]): string {
  const verb = decision === 'approved' ? 'approved' : 'rejected';
  if (override === 'self') return `${deciderName} ${verb} their own request as admin`;
  const who = waitingOn.length ? ` (${waitingOn.join(' or ')})` : '';
  return `${deciderName} ${verb} as admin, skipping level ${level}${who}`;
}

/** Hours since a time, for nudges and escalations. */
export const hoursSince = (d: Date, now: Date = new Date()) => (now.getTime() - d.getTime()) / 3_600_000;

/**
 * Overall discount and margin of a document, as percentages. Discount is
 * item + order discount over the subtotal; margin is what is left of the
 * taxable value after goods cost, freight and incentive. Margin is null when
 * the cost is not known - an unknown cost must never pass for a full margin.
 */
export function pricingOf(d: {
  subtotalPaise: number; itemDiscountPaise: number; orderDiscountPaise: number; taxableBasePaise: number;
  costPricePaise?: number | null; transportPaise?: number | null; incentivePaise?: number | null;
}): { discountPct: number | null; marginPct: number | null } {
  const discountPct = d.subtotalPaise > 0 ? ((d.itemDiscountPaise + d.orderDiscountPaise) / d.subtotalPaise) * 100 : null;
  const cost = d.costPricePaise ?? 0;
  const marginPct = cost > 0 && d.taxableBasePaise > 0
    ? ((d.taxableBasePaise - cost - (d.transportPaise ?? 0) - (d.incentivePaise ?? 0)) / d.taxableBasePaise) * 100
    : null;
  return { discountPct, marginPct };
}
