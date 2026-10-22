import 'server-only';
import { db } from './db';
import type { StoreScope } from './store-scope';
import { HELD_ACTION_TYPES, heldActionHandler } from './approval-actions';

/**
 * Per request type: how to describe it, how to decide it through the
 * module's OWN decide function (so a decision from My Reminders & Requests
 * is exactly the same as one from the module's screen), and which records
 * are waiting with no request open (decided on their own screen - shown to
 * the owner). 27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §3-4.
 *
 * Modules are imported lazily: they import the approval engine themselves.
 */
export interface Described { title: string; summary: string | null; amountPaise: number | null; requesterId: string | null }
export interface PendingDirect extends Omit<Described, 'requesterId'> { id: string; requesterId: string | null; since: Date }

export interface ApprovalHandler {
  describe(storeId: string, id: string): Promise<Described | null>;
  /** `auto`: approved by the rules, not a person - no approver check. */
  decide(scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, note: string | null, auto: boolean): Promise<void>;
  pendingDirect(storeId: string): Promise<PendingDirect[]>;
}

const rupees = (p: number | null | undefined) => (p ? `₹${(p / 100).toLocaleString('en-IN')}` : null);
const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const noRequestFor = async (type: string, ids: string[]) => {
  const have = await db.approvalRequest.findMany({ where: { entityType: type, entityId: { in: ids } }, select: { entityId: true } });
  const set = new Set(have.map((h) => h.entityId));
  return (id: string) => !set.has(id);
};
const TAKE = 100;

// ------------------------------------------------------------------ gate for non-engine modules

/**
 * For modules that keep their own status (orders, POs, vouchers, challans):
 * walk the engine when a request is open. Returns true when the record
 * should now take the final decision, false when the step was recorded and
 * it waits on the next level.
 */
export async function gateDecision(
  scope: StoreScope, type: string, id: string, decision: 'approved' | 'rejected', userId: string, note: string | null, auto: boolean,
): Promise<boolean> {
  if (auto) return true;
  const { openApprovalRequest, decideApprovalStep } = await import('./hierarchy');
  const open = await openApprovalRequest(scope, type, id);
  if (!open) return true;
  const step = await decideApprovalStep(scope, open.id, decision, userId, note);
  return step.final !== null;
}

// ------------------------------------------------------------------ the registry

/** One line for a job waiting to close: how the customer confirmed (workflow slice 6). */
function closeSummary(signOff: string | null, needsCallback: boolean): string {
  if (needsCallback) return 'Technician says the customer approved (no code) - call the customer before closing.';
  return signOff === 'otp' ? 'Customer confirmed with their code.' : signOff === 'customer' ? 'Customer confirmed in the app / link.'
    : signOff === 'office' ? 'Marked done by the office.' : 'Marked done by the technician.';
}

const HANDLERS: Record<string, ApprovalHandler> = {
  leave: leaveLike('leave'),
  wfh: leaveLike('wfh'),

  comp_off: {
    async describe(storeId, id) {
      const r = await db.compOffEntry.findFirst({ where: { id, storeId }, select: { userId: true, days: true, reason: true } });
      return r && { title: `Comp-off, ${r.days} day${r.days === 1 ? '' : 's'}`, summary: r.reason, amountPaise: null, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideCompOffRequest } = await import('./leave-types');
      await decideCompOffRequest(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.compOffEntry.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, userId: true, days: true, reason: true, createdAt: true } });
      const free = await noRequestFor('comp_off', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Comp-off, ${r.days} day(s)`, summary: r.reason, amountPaise: null, requesterId: r.userId, since: r.createdAt }));
    },
  },

  leave_allocation: {
    async describe(storeId, id) {
      const r = await db.leaveAllocationRequest.findFirst({ where: { id, storeId }, select: { userId: true, requestedDays: true, description: true } });
      return r && { title: `Extra leave, ${r.requestedDays} day(s)`, summary: r.description, amountPaise: null, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideLeaveAllocationRequest } = await import('./leave-types');
      await decideLeaveAllocationRequest(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.leaveAllocationRequest.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, userId: true, requestedDays: true, description: true, createdAt: true } });
      const free = await noRequestFor('leave_allocation', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Extra leave, ${r.requestedDays} day(s)`, summary: r.description, amountPaise: null, requesterId: r.userId, since: r.createdAt }));
    },
  },

  reimbursement: {
    async describe(storeId, id) {
      const r = await db.reimbursementClaim.findFirst({ where: { id, storeId }, select: { userId: true, category: true, amountPaise: true, description: true } });
      return r && { title: `Reimbursement: ${r.category} ${rupees(r.amountPaise)}`, summary: r.description, amountPaise: r.amountPaise, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideReimbursement } = await import('./staff-claims');
      await decideReimbursement(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.reimbursementClaim.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, userId: true, category: true, amountPaise: true, description: true, createdAt: true } });
      const free = await noRequestFor('reimbursement', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Reimbursement: ${r.category} ${rupees(r.amountPaise)}`, summary: r.description, amountPaise: r.amountPaise, requesterId: r.userId, since: r.createdAt }));
    },
  },

  leave_encashment: {
    async describe(storeId, id) {
      const r = await db.leaveEncashment.findFirst({ where: { id, storeId }, select: { userId: true, days: true, amountPaise: true } });
      return r && { title: `Leave encashment, ${Number(r.days)} day(s) ${rupees(r.amountPaise)}`, summary: null, amountPaise: r.amountPaise, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideEncashment } = await import('./staff-claims');
      await decideEncashment(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.leaveEncashment.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, userId: true, days: true, amountPaise: true, createdAt: true } });
      const free = await noRequestFor('leave_encashment', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Leave encashment ${rupees(r.amountPaise)}`, summary: null, amountPaise: r.amountPaise, requesterId: r.userId, since: r.createdAt }));
    },
  },

  asset_request: {
    async describe(storeId, id) {
      const r = await db.assetRequest.findFirst({ where: { id, storeId }, select: { requestedById: true, assetType: true, reason: true } });
      return r && { title: `Asset request: ${r.assetType}`, summary: r.reason, amountPaise: null, requesterId: r.requestedById };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideAssetRequest } = await import('./assets');
      await decideAssetRequest(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.assetRequest.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, requestedById: true, assetType: true, reason: true, createdAt: true } });
      const free = await noRequestFor('asset_request', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Asset request: ${r.assetType}`, summary: r.reason, amountPaise: null, requesterId: r.requestedById, since: r.createdAt }));
    },
  },

  resignation: {
    async describe(storeId, id) {
      const r = await db.resignation.findFirst({ where: { id, storeId }, select: { userId: true, lastWorkingDay: true, reason: true } });
      return r && { title: `Resignation, last day ${day(r.lastWorkingDay)}`, summary: r.reason, amountPaise: null, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideResignation } = await import('./offboarding');
      await decideResignation(scope, id, decision === 'approved' ? 'accepted' : 'rejected', userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.resignation.findMany({ where: { storeId, status: 'submitted' }, take: TAKE, select: { id: true, userId: true, lastWorkingDay: true, reason: true, createdAt: true } });
      const free = await noRequestFor('resignation', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Resignation, last day ${day(r.lastWorkingDay)}`, summary: r.reason, amountPaise: null, requesterId: r.userId, since: r.createdAt }));
    },
  },

  sales_order: {
    async describe(storeId, id) {
      const r = await db.salesOrder.findFirst({ where: { id, storeId }, select: { orderNo: true, customerName: true, grandTotalPaise: true, createdBy: true } });
      return r && { title: `Sales order ${r.orderNo} ${rupees(r.grandTotalPaise)}`, summary: r.customerName, amountPaise: r.grandTotalPaise, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'sales_order', id, decision, userId, note, auto))) return;
      const { moveFulfilment } = await import('./sales-orders');
      const order = await db.salesOrder.findFirst({ where: { id }, select: { fulfilmentStatus: true } });
      if (order?.fulfilmentStatus !== 'pending_approval') return;
      await moveFulfilment(scope, id, decision === 'approved' ? 'confirmed' : 'hold', userId);
    },
    async pendingDirect(storeId) {
      const rows = await db.salesOrder.findMany({ where: { storeId, fulfilmentStatus: 'pending_approval' }, take: TAKE, select: { id: true, orderNo: true, customerName: true, grandTotalPaise: true, createdBy: true, createdAt: true } });
      const free = await noRequestFor('sales_order', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Sales order ${r.orderNo} ${rupees(r.grandTotalPaise)}`, summary: r.customerName, amountPaise: r.grandTotalPaise, requesterId: r.createdBy, since: r.createdAt }));
    },
  },

  credit_note: {
    async describe(storeId, id) {
      const r = await db.creditNote.findFirst({ where: { id, storeId }, select: { creditNoteNo: true, grandTotalPaise: true, customerName: true, createdBy: true } });
      return r && { title: `Credit note ${r.creditNoteNo} ${rupees(r.grandTotalPaise)}`, summary: r.customerName, amountPaise: r.grandTotalPaise, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'credit_note', id, decision, userId, note, auto))) return;
      // Rejected: it stays a draft; the person who raised it is told why.
      if (decision !== 'approved') return;
      const { issueApprovedCreditNote } = await import('./credit-notes');
      const cn = await db.creditNote.findFirst({ where: { id }, select: { lifecycle: true } });
      if (cn?.lifecycle === 'draft') await issueApprovedCreditNote(scope, id, userId);
    },
    async pendingDirect() {
      // A draft credit note waits only when a rule says it must.
      return [];
    },
  },

  purchase_bill: {
    async describe(storeId, id) {
      const r = await db.purchaseBill.findFirst({ where: { id, storeId }, select: { billNo: true, supplierBillNo: true, grandTotalPaise: true, createdBy: true, party: { select: { companyName: true, firstName: true } } } });
      return r && { title: `Purchase bill ${r.supplierBillNo || r.billNo} ${rupees(r.grandTotalPaise)}`, summary: r.party.companyName || r.party.firstName, amountPaise: r.grandTotalPaise, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'purchase_bill', id, decision, userId, note, auto))) return;
      if (decision !== 'approved') return; // stays a draft; the requester sees the reason
      const { postApprovedBill } = await import('./purchases');
      const bill = await db.purchaseBill.findFirst({ where: { id }, select: { lifecycle: true } });
      if (bill?.lifecycle === 'draft') await postApprovedBill(scope, id, userId);
    },
    async pendingDirect() {
      return [];
    },
  },

  purchase_order: {
    async describe(storeId, id) {
      const r = await db.purchaseOrder.findFirst({ where: { id, storeId }, select: { orderNo: true, grandTotalPaise: true, createdBy: true, party: { select: { companyName: true, firstName: true } } } });
      return r && { title: `Purchase order ${r.orderNo} ${rupees(r.grandTotalPaise)}`, summary: r.party.companyName || r.party.firstName, amountPaise: r.grandTotalPaise, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'purchase_order', id, decision, userId, note, auto))) return;
      if (decision !== 'approved') return; // stays Sent; the requester sees the reason and edits or cancels
      const { movePoStatus } = await import('./purchase-orders');
      const po = await db.purchaseOrder.findFirst({ where: { id }, select: { status: true } });
      if (po?.status === 'sent') await movePoStatus(scope, id, 'approved', userId);
    },
    async pendingDirect() {
      // A PO waits only when a rule says it must - "sent" alone is not a request.
      return [];
    },
  },

  expense: {
    async describe(storeId, id) {
      const r = await db.transaction.findFirst({ where: { id, storeId }, select: { txnNo: true, amountPaise: true, description: true, createdBy: true } });
      return r && { title: `Voucher ${r.txnNo} ${rupees(r.amountPaise)}`, summary: r.description, amountPaise: r.amountPaise, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'expense', id, decision, userId, note, auto))) return;
      const { approveTransaction, rejectTransaction } = await import('./transactions');
      const t = await db.transaction.findFirst({ where: { id }, select: { status: true } });
      if (t?.status !== 'pending') return;
      if (decision === 'approved') await approveTransaction(scope, id, userId);
      else await rejectTransaction(scope, id, note ?? 'Rejected', userId);
    },
    async pendingDirect(storeId) {
      const rows = await db.transaction.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, txnNo: true, amountPaise: true, description: true, createdBy: true, createdAt: true } });
      const free = await noRequestFor('expense', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Voucher ${r.txnNo} ${rupees(r.amountPaise)}`, summary: r.description, amountPaise: r.amountPaise, requesterId: r.createdBy, since: r.createdAt }));
    },
  },

  installation_challan: {
    async describe(storeId, id) {
      const r = await db.installationChallan.findFirst({ where: { id, storeId }, select: { challanNo: true, createdBy: true } });
      return r && { title: `Installation challan ${r.challanNo} - work done`, summary: null, amountPaise: null, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'installation_challan', id, decision, userId, note, auto))) return;
      const { setInstallationChallanStatus } = await import('./installation-challans');
      const c = await db.installationChallan.findFirst({ where: { id }, select: { status: true } });
      if (c?.status !== 'work_done') return;
      await setInstallationChallanStatus(scope, { id, to: decision, reason: note }, userId);
    },
    async pendingDirect(storeId) {
      const rows = await db.installationChallan.findMany({ where: { storeId, status: 'work_done' }, take: TAKE, select: { id: true, challanNo: true, createdBy: true, updatedAt: true } });
      const free = await noRequestFor('installation_challan', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Installation challan ${r.challanNo} - work done`, summary: null, amountPaise: null, requesterId: r.createdBy, since: r.updatedAt }));
    },
  },

  repair_challan: {
    async describe(storeId, id) {
      const r = await db.repairChallan.findFirst({ where: { id, storeId }, select: { challanNo: true, createdBy: true } });
      return r && { title: `Repair challan ${r.challanNo} - work done`, summary: null, amountPaise: null, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note, auto) {
      if (!(await gateDecision(scope, 'repair_challan', id, decision, userId, note, auto))) return;
      const c = await db.repairChallan.findFirst({ where: { id }, select: { status: true, storeId: true, challanNo: true } });
      if (c?.status !== 'work_done') return;
      await db.repairChallan.update({ where: { id }, data: { status: decision } });
      await db.activityLog.create({
        data: {
          storeId: c.storeId, userId, activityType: 'Status Change', entityType: 'RepairChallan', entityId: id,
          description: `Repair challan ${c.challanNo} ${decision}${note ? ` - ${note}` : ''}`, statusFrom: 'work_done', statusTo: decision,
        },
      }).catch(() => undefined);
    },
    async pendingDirect(storeId) {
      const rows = await db.repairChallan.findMany({ where: { storeId, status: 'work_done' }, take: TAKE, select: { id: true, challanNo: true, createdBy: true, createdAt: true } });
      const free = await noRequestFor('repair_challan', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Repair challan ${r.challanNo} - work done`, summary: null, amountPaise: null, requesterId: r.createdBy, since: r.createdAt }));
    },
  },

  site_override: {
    async describe(storeId, id) {
      const r = await db.siteOverride.findFirst({ where: { id, storeId }, select: { requestedBy: true, reason: true, distanceM: true, complaint: { select: { complaintNo: true } } } });
      return r && { title: `Location override for ${r.complaint.complaintNo}`, summary: `${r.reason}${r.distanceM !== null ? ` (${r.distanceM} m from the site)` : ''}`, amountPaise: null, requesterId: r.requestedBy };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideSiteOverride } = await import('./job-onsite');
      await decideSiteOverride(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.siteOverride.findMany({ where: { storeId, status: 'pending' }, take: TAKE, select: { id: true, requestedBy: true, reason: true, createdAt: true, complaint: { select: { complaintNo: true } } } });
      const free = await noRequestFor('site_override', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Location override for ${r.complaint.complaintNo}`, summary: r.reason, amountPaise: null, requesterId: r.requestedBy, since: r.createdAt }));
    },
  },

  job_challan: {
    async describe(storeId, id) {
      const r = await db.jobChallan.findFirst({ where: { id, storeId }, select: { challanNo: true, createdBy: true, note: true, lines: { select: { qty: true, product: { select: { productName: true } } } }, complaint: { select: { complaintNo: true } }, installationChallan: { select: { challanNo: true } } } });
      return r && { title: `Parts for ${r.complaint?.complaintNo ?? r.installationChallan?.challanNo ?? '-'}: challan ${r.challanNo}`, summary: r.lines.map((l) => `${l.product.productName} × ${l.qty}`).join(', ') + (r.note ? ` - ${r.note}` : ''), amountPaise: null, requesterId: r.createdBy };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideJobChallan } = await import('./job-challans');
      await decideJobChallan(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.jobChallan.findMany({ where: { storeId, status: 'pending_approval' }, take: TAKE, select: { id: true, challanNo: true, createdBy: true, createdAt: true, complaint: { select: { complaintNo: true } }, installationChallan: { select: { challanNo: true } } } });
      const free = await noRequestFor('job_challan', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Parts for ${r.complaint?.complaintNo ?? r.installationChallan?.challanNo ?? '-'}: challan ${r.challanNo}`, summary: null, amountPaise: null, requesterId: r.createdBy, since: r.createdAt }));
    },
  },

  warranty_void: {
    async describe(storeId, id) {
      const r = await db.complaintItem.findFirst({ where: { id, storeId }, select: { equipmentName: true, serialNo: true, voidReason: true, voidRequestedBy: true, complaint: { select: { complaintNo: true } } } });
      return r && { title: `Void warranty: ${r.equipmentName}${r.serialNo ? ` (${r.serialNo})` : ''} on ${r.complaint.complaintNo}`, summary: `${r.voidReason ?? ''} - photo on the job`, amountPaise: null, requesterId: r.voidRequestedBy };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideWarrantyVoid } = await import('./complaint-items');
      await decideWarrantyVoid(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.complaintItem.findMany({ where: { storeId, voidStatus: 'requested' }, take: TAKE, select: { id: true, equipmentName: true, voidReason: true, voidRequestedBy: true, voidRequestedAt: true, updatedAt: true, complaint: { select: { complaintNo: true } } } });
      const free = await noRequestFor('warranty_void', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Void warranty: ${r.equipmentName} on ${r.complaint.complaintNo}`, summary: r.voidReason, amountPaise: null, requesterId: r.voidRequestedBy, since: r.voidRequestedAt ?? r.updatedAt }));
    },
  },

  job_close: {
    async describe(storeId, id) {
      const r = await db.complaint.findFirst({ where: { id, storeId }, select: { complaintNo: true, signOff: true, needsCallback: true, assignedTechnicianId: true, customer: { select: { companyName: true, firstName: true } } } });
      return r && { title: `Close job ${r.complaintNo} - ${r.customer.companyName || r.customer.firstName || 'customer'}`, summary: closeSummary(r.signOff, r.needsCallback), amountPaise: null, requesterId: r.assignedTechnicianId };
    },
    async decide(scope, id, decision, userId, note, auto) {
      const { decideJobClose } = await import('./job-signoff');
      await decideJobClose(scope, id, decision, userId, note, auto);
    },
    async pendingDirect(storeId) {
      // With approval to close switched off, the office closes from the job page instead.
      const { getJobSettings } = await import('./job-settings');
      if (!(await getJobSettings(storeId)).approvalToClose) return [];
      const rows = await db.complaint.findMany({ where: { storeId, status: 'resolved' }, take: TAKE, orderBy: { resolvedAt: 'asc' }, select: { id: true, complaintNo: true, signOff: true, needsCallback: true, assignedTechnicianId: true, resolvedAt: true, updatedAt: true } });
      const free = await noRequestFor('job_close', rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: `Close job ${r.complaintNo}`, summary: closeSummary(r.signOff, r.needsCallback), amountPaise: null, requesterId: r.assignedTechnicianId, since: r.resolvedAt ?? r.updatedAt }));
    },
  },
};

function leaveLike(kind: 'leave' | 'wfh'): ApprovalHandler {
  const label = kind === 'wfh' ? 'Work from home' : 'Leave';
  const title = (r: { fromDate: Date; toDate: Date }) => `${label} ${day(r.fromDate)}${r.toDate.getTime() !== r.fromDate.getTime() ? ` - ${day(r.toDate)}` : ''}`;
  return {
    async describe(storeId, id) {
      const r = await db.leaveRequest.findFirst({ where: { id, storeId }, select: { userId: true, fromDate: true, toDate: true, reason: true } });
      return r && { title: title(r), summary: r.reason, amountPaise: null, requesterId: r.userId };
    },
    async decide(scope, id, decision, userId, note) {
      const { decideLeaveRequest } = await import('./attendance');
      await decideLeaveRequest(scope, id, decision, userId, note);
    },
    async pendingDirect(storeId) {
      const rows = await db.leaveRequest.findMany({ where: { storeId, status: 'pending', kind: kind === 'wfh' ? 'wfh' : { not: 'wfh' } }, take: TAKE, select: { id: true, userId: true, fromDate: true, toDate: true, reason: true, createdAt: true } });
      const free = await noRequestFor(kind, rows.map((r) => r.id));
      return rows.filter((r) => free(r.id)).map((r) => ({ id: r.id, title: title(r), summary: r.reason, amountPaise: null, requesterId: r.userId, since: r.createdAt }));
    },
  };
}

/** Held actions (server/approval-actions) share one handler shape. */
export const approvalHandler = (type: string): ApprovalHandler | undefined =>
  HANDLERS[type] ?? (HELD_ACTION_TYPES.includes(type) ? heldActionHandler(type) : undefined);
