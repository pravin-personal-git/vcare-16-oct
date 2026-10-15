import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import type { ApprovalHandler } from './approval-handlers';

/**
 * HELD ACTIONS (5 Oct 2026).
 *
 * Credit notes and purchase bills (earlier the same day) had a draft state to
 * wait in. Most of what moves a business's money does not: cancelling an
 * invoice, refunding a customer, paying a supplier, reversing a receipt,
 * processing payroll. So the action itself waits. When an Approval Rule says
 * it needs a sign-off, its details are saved on the request (`payload`) and it
 * is carried out - by the code that would have run anyway - only once the last
 * level approves.
 *
 * NO RULE SAVED = EXACTLY AS BEFORE. Nothing here changes anybody's day until
 * the owner switches a type on in Settings > Approval Rules.
 *
 * Pressing the same button again while a request is open counts as that
 * person's approval, with every check Waiting on me applies (own request,
 * level, owner override) - so an approver never has to go looking for it.
 *
 * A failure when the approved action finally runs (the invoice was already
 * paid, the period was closed meanwhile) is shown to the approver; the request
 * stays recorded as approved and the action can simply be done again.
 */

type Payload = Record<string, unknown>;
const iso = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : null);

/** What each held action runs once approved. The labels live in lib/approval-rules. */
const RUN: Record<string, (scope: StoreScope, entityId: string, p: Payload, userId: string) => Promise<void>> = {
  quotation_send: async (scope, id) => {
    const { setQuotationStatus } = await import('./quotations');
    const q = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (q?.status === 'draft') await setQuotationStatus(scope, id, 'sent');
  },
  invoice_issue: async (scope, id, _p, userId) => {
    const { issueInvoice } = await import('./invoices');
    const inv = await db.invoice.findFirst({ where: { id }, select: { lifecycle: true } });
    if (inv?.lifecycle === 'draft') await issueInvoice(scope, id, userId);
  },
  invoice_cancel: async (scope, id, p, userId) => {
    const { cancelInvoice } = await import('./invoices');
    await cancelInvoice(scope, id, String(p.reason ?? ''), userId);
  },
  invoice_edit: async (scope, id, p, userId) => {
    const { editIssuedInvoice } = await import('./invoices');
    const input = p as unknown as Parameters<typeof editIssuedInvoice>[2];
    await editIssuedInvoice(scope, id, { ...input, invoiceDate: iso(p.invoiceDate) ?? new Date() }, userId);
  },
  sales_return: async (scope, id, _p, userId) => {
    const { receiveReturn } = await import('./sales-returns');
    await receiveReturn(scope, id, userId);
  },
  order_cancel_paid: async (scope, id, p, userId) => {
    const { cancelSalesOrder, moveFulfilment } = await import('./sales-orders');
    // The list's "Cancel order" moves the order to Void; the cancel action with
    // a reason is the other door. Both end in a cancelled order.
    if (p.via === 'void') await moveFulfilment(scope, id, 'void', userId);
    else await cancelSalesOrder(scope, id, String(p.reason ?? ''), userId);
  },
  refund: async (scope, _id, p, userId) => {
    const { recordRefund } = await import('./credit-notes');
    await recordRefund(scope, {
      creditNoteId: String(p.creditNoteId), amountPaise: Number(p.amountPaise), method: String(p.method),
      refundedAt: iso(p.refundedAt), reference: (p.reference as string | null) ?? null, note: (p.note as string | null) ?? null,
    }, userId);
  },
  receipt_reverse: async (scope, id, p, userId) => {
    const { reverseReceipt } = await import('./receipts');
    await reverseReceipt(scope, id, p.status === 'bounced' ? 'bounced' : 'reversed', String(p.reason ?? ''), userId);
  },
  supplier_payment: async (scope, _id, p, userId) => {
    const { paySupplier } = await import('./purchases');
    const input = p as unknown as Parameters<typeof paySupplier>[1];
    await paySupplier(scope, { ...input, paidAt: iso(p.paidAt) ?? undefined }, userId);
  },
  supplier_payment_reverse: async (scope, id, p, userId) => {
    const { reversePayment } = await import('./purchases');
    await reversePayment(scope, id, String(p.reason ?? ''), userId);
  },
  debit_note: async (scope, id, p, userId) => {
    const { issueDebitNote } = await import('./purchase-returns');
    await issueDebitNote(scope, { purchaseReturnId: id, reason: String(p.reason ?? ''), debitNoteDate: iso(p.debitNoteDate) }, userId);
  },
  period_reopen: async (scope, _id, p, userId) => {
    const { setPeriodLock } = await import('./accounting-periods');
    await setPeriodLock(scope, userId, {
      financialYear: Number(p.financialYear), monthIndex: Number(p.monthIndex), locked: false, reason: (p.reason as string) ?? undefined,
    });
  },
  credit_limit: async (scope, id, p) => {
    const party = await db.party.findFirst({ where: { id, storeId: scopeForWrite(scope) }, select: { id: true } });
    if (!party) throw new Error('That customer is not in your scope any more.');
    await db.party.update({
      where: { id },
      data: {
        creditLimitPaise: Number(p.creditLimitPaise),
        ...(typeof p.creditLimitDays === 'number' ? { creditLimitDays: p.creditLimitDays } : {}),
      },
    });
  },
  price_change: async (scope, id, p) => {
    const { updateProduct } = await import('./products');
    await updateProduct(scope, id, {
      ...(p.dlpPaise !== undefined ? { dlpPaise: Number(p.dlpPaise) } : {}),
      ...(p.mrpPaise !== undefined ? { mrpPaise: Number(p.mrpPaise) } : {}),
    } as Parameters<typeof updateProduct>[2]);
  },
  payroll_process: async (scope, id, _p, userId) => {
    const { processPayrollRun } = await import('./payroll-run');
    await processPayrollRun(scope, id, userId);
  },
  payroll_revert: async (scope, id, p, userId) => {
    const { revertPayrollRun } = await import('./payroll-run');
    await revertPayrollRun(scope, id, String(p.reason ?? ''), userId);
  },
  payroll_paid: async (scope, id, p, userId) => {
    const { markPayrollRunPaid } = await import('./payroll-run');
    await markPayrollRunPaid(scope, id, String(p.method ?? 'bank'), userId);
  },
  staff_loan: async (scope, _id, p, userId) => {
    const { createLoan } = await import('./staff-loans');
    const input = p as unknown as Parameters<typeof createLoan>[1];
    await createLoan(scope, { ...input, startPeriod: iso(p.startPeriod) ?? new Date() }, userId);
  },
  van_writeoff: async (scope, _id, p, userId) => {
    const { writeOffVanShortfall } = await import('./van-stock');
    await writeOffVanShortfall(scope, p as unknown as Parameters<typeof writeOffVanShortfall>[1], userId);
  },
};

export const HELD_ACTION_TYPES = Object.keys(RUN);

/** Run the approved action with what the request saved. */
async function runApproved(scope: StoreScope, type: string, entityId: string, userId: string) {
  const req = await db.approvalRequest.findFirst({
    where: { storeId: scopeForWrite(scope), entityType: type, entityId, status: 'APPROVED' },
    orderBy: { decidedAt: 'desc' },
    select: { payload: true },
  });
  await RUN[type](scope, entityId, (req?.payload ?? {}) as Payload, userId);
}

/** One handler shape for every held action, for the approval engine's registry. */
export function heldActionHandler(type: string): ApprovalHandler {
  return {
    async describe(storeId, id) {
      // The request carries its own title, summary and amount, written when it
      // was raised - an action has no record of its own to describe it from.
      const r = await db.approvalRequest.findFirst({
        where: { storeId, entityType: type, entityId: id }, orderBy: { createdAt: 'desc' },
        select: { title: true, summary: true, amountPaise: true, requestedBy: true },
      });
      return r && { title: r.title ?? type, summary: r.summary, amountPaise: r.amountPaise, requesterId: r.requestedBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      const { gateDecision } = await import('./approval-handlers');
      if (!(await gateDecision(scope, type, id, decision, userId, note, auto))) return;
      if (decision === 'approved') await runApproved(scope, type, id, userId);
    },
    async pendingDirect() {
      // A held action only ever waits under a rule, as an open request.
      return [];
    },
  };
}

export type GateResult = { held: false } | { held: true; message: string };

export interface ActionSpec {
  type: string;
  /** The record the action is about; a new record (a payment, a loan) gets a fresh id. */
  entityId: string;
  /**
   * Where the approver should go to judge it.
   *
   * A held action's `entityId` is a fresh id for something that does not
   * exist yet, so the type's usual `?open=<id>` link has nothing to find.
   * Pass the screen that shows the context instead.
   */
  href?: string | null;
  amountPaise: number | null;
  title: string;
  summary?: string | null;
  payload?: Payload;
  /**
   * For a document that is approved once and then used freely (a quotation is
   * approved, then shared as often as needed): an earlier approval whose saved
   * payload matches these values lets the action through. Pass what defines
   * the document's content - its total - so a quotation edited to a different
   * figure needs approving again, while sending it twice does not.
   */
  approvedIfSame?: Payload;
  /** Discount and margin, for quotation / invoice rules that test them. */
  pricing?: { discountPct: number | null; marginPct: number | null };
}

/**
 * Ask whether an action may go ahead now. `held: false` - carry on as usual.
 * `held: true` - it is waiting (or was just approved and done by this click);
 * show the message and do nothing more.
 */
export async function gateAction(scope: StoreScope, userId: string, a: ActionSpec): Promise<GateResult> {
  const storeId = scopeForWrite(scope);

  const { openApprovalRequest } = await import('./hierarchy');
  if (await openApprovalRequest(scope, a.type, a.entityId)) {
    const { gateDecision } = await import('./approval-handlers');
    const final = await gateDecision(scope, a.type, a.entityId, 'approved', userId, null, false);
    if (!final) return { held: true, message: 'Your approval is recorded. It now waits on the next approver.' };
    await runApproved(scope, a.type, a.entityId, userId);
    return { held: true, message: 'Approved and done.' };
  }

  if (a.approvedIfSame) {
    const done = await db.approvalRequest.findMany({
      where: { storeId, entityType: a.type, entityId: a.entityId, status: 'APPROVED' },
      orderBy: { decidedAt: 'desc' }, take: 5, select: { payload: true },
    });
    const same = (p: unknown) => Object.entries(a.approvedIfSame!).every(([k, v]) => (p as Payload | null)?.[k] === v);
    if (done.some((d) => same(d.payload))) return { held: false };
  }

  const { approvalNeeded, requestApproval, currentApprovers } = await import('./approvals');
  if (!(await approvalNeeded(storeId, a.type, userId, a.amountPaise, a.pricing))) return { held: false };

  const answer = await requestApproval(storeId, {
    type: a.type, entityId: a.entityId, requesterId: userId, amountPaise: a.amountPaise,
    title: a.title, summary: a.summary ?? null, payload: (a.payload ?? {}) as Prisma.InputJsonValue,
    href: a.href ?? null,
    pricing: a.pricing,
  });
  let who = '';
  if (!answer.auto && answer.requestId) {
    const req = await db.approvalRequest.findUnique({ where: { id: answer.requestId } });
    if (req) {
      const ids = await currentApprovers(req);
      const names = (await db.user.findMany({ where: { id: { in: ids } }, select: { fullName: true } })).map((u) => u.fullName);
      if (names.length) who = ` It waits on ${names.join(' or ')}.`;
    }
  }
  return { held: true, message: `Sent for approval - it happens once approved.${who} Track it in My Desk.` };
}

/** A fresh id for an action that creates something new (a payment, a loan). */
export function newActionId(): string {
  return `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The usual call from a server action: null = go ahead as normal; a string =
 * the action is held (or was just approved and done by this click) and this is
 * what to tell the person. All-branches view never holds - writes there are
 * refused by the action itself.
 */
export async function heldMessage(scope: StoreScope, userId: string, spec: ActionSpec): Promise<string | null> {
  if (scope.kind !== 'single') return null;
  const r = await gateAction(scope, userId, spec);
  return r.held ? r.message : null;
}

export const rupeesText = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;


export { pricingOf } from '@/lib/approval-rules';
