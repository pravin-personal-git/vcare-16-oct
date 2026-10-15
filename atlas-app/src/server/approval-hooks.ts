import 'server-only';
import type { StoreScope } from './store-scope';

/**
 * The two calls a module makes into approval rules (27 Sep 2026,
 * NOTIFICATIONS-APPROVALS-SPEC.md §4). Kept apart from approvals.ts so a
 * module can import them without pulling the whole engine at load time.
 */

/**
 * A record just entered its "waiting" state (a voucher saved as pending, a
 * challan marked work done, a PO sent): ask the rules, approve at once when
 * they say so, otherwise the approvers are notified. Never throws - a
 * notification problem must not stop the record being saved.
 */
export async function onPending(storeId: string, type: string, entityId: string, requesterId: string | null) {
  if (!requesterId) return;
  const { requestOrApprove } = await import('./approvals');
  await requestOrApprove(storeId, { type, entityId, requesterId }).catch((e) => console.error(`[approvals] ${type} request failed`, e));
}

/** Thrown when a module screen's Approve recorded one level of several. */
export class ApprovalStepRecorded extends Error {
  constructor() { super('Your approval is recorded. It now waits on the next approver.'); }
}

/**
 * The module screen's own Approve / Reject: when a request is open, the same
 * approver check as My Reminders & Requests. Returns when the record should
 * take the final status; throws ApprovalStepRecorded when it now waits on the
 * next level.
 */
export async function screenDecision(
  scope: StoreScope, type: string, entityId: string, decision: 'approved' | 'rejected', userId: string, note: string | null,
): Promise<void> {
  const { gateDecision } = await import('./approval-handlers');
  const final = await gateDecision(scope, type, entityId, decision, userId, note, false);
  if (!final) throw new ApprovalStepRecorded();
}
