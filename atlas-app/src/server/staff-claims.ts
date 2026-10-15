import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { createStaffTransaction } from './staff-accounts';
import { encashmentRatePaise, encashmentAmountPaise } from '@/lib/leave-encashment';

/**
 * Encashments & Reimbursements (roadmap §4.5) - `LeaveEncashment` and
 * `ReimbursementClaim` existed in schema and were already registered in
 * `HIERARCHY_ROUTED_ENTITIES`, but per the payroll-schema commit's own
 * notes, "not yet raised from anywhere." Request/decide mirrors
 * `submitResignation`/`decideResignation` in offboarding.ts almost exactly
 * - same hierarchy-routing shape, same "chain if configured, direct if
 * not" decide step.
 */
export class StaffClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffClaimError';
  }
}

// ---------------------------------------------------------------- ENCASHMENT

export interface EncashmentRow {
  id: string;
  userId: string;
  userName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  days: number;
  ratePaise: number;
  amountPaise: number;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export async function listEncashments(scope: StoreScope): Promise<EncashmentRow[]> {
  const rows = await db.leaveEncashment.findMany({
    where: scopeWhere(scope),
    include: { user: { select: { fullName: true } }, leaveType: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName,
    leaveTypeId: r.leaveTypeId, leaveTypeName: r.leaveType.name,
    days: Number(r.days), ratePaise: r.ratePaise, amountPaise: r.amountPaise,
    status: r.status, decidedAt: r.decidedAt, decisionNote: r.decisionNote, createdAt: r.createdAt,
  }));
}

export async function requestLeaveEncashment(
  scope: StoreScope, input: { leaveTypeId: string; days: number }, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.days <= 0) throw new StaffClaimError('Enter a number of days greater than zero.');

  const leaveType = await db.leaveType.findFirst({ where: { id: input.leaveTypeId, storeId } });
  if (!leaveType) throw new StaffClaimError('Leave type not found in your scope.');

  const contract = await db.salaryContract.findFirst({
    where: { storeId, userId, isActive: true, effectiveTo: null },
  });
  if (!contract) throw new StaffClaimError('You have no active salary contract - ask HR to set one up first.');

  const ratePaise = encashmentRatePaise(contract.ctcAnnualPaise);
  const amountPaise = encashmentAmountPaise(ratePaise, input.days);

  const encashment = await db.leaveEncashment.create({
    data: {
      storeId, userId, leaveTypeId: input.leaveTypeId, days: input.days,
      ratePaise, amountPaise, requestedBy: userId,
    },
  });

  await raiseApproval(scope, 'leave_encashment', encashment.id, userId);
}

export async function decideEncashment(
  scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const existing = await db.leaveEncashment.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new StaffClaimError('Encashment request not found in your scope.');
  if (existing.status !== 'pending') throw new StaffClaimError(`That request was already ${existing.status}.`);

  const openRequest = await openApprovalRequest(scope, 'leave_encashment', existing.id);
  let finalStatus: 'approved' | 'rejected' | null = decision;

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new StaffClaimError(e.message);
      throw e;
    }
    if (step.final === null) return; // more levels still to clear
    finalStatus = step.final === 'APPROVED' ? 'approved' : 'rejected';
  }

  await db.leaveEncashment.update({
    where: { id: existing.id },
    data: { status: finalStatus, decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
  });

  // Approval is what recognises the liability - Dr Expense / Cr Staff
  // Payable - same "claimed now, paid later" two-step as a reimbursement.
  // Rejecting one never touches the ledger at all.
  if (finalStatus === 'approved') {
    await createStaffTransaction(scope, {
      userId: existing.userId, kind: 'expense_claimed', amountPaise: existing.amountPaise,
      txnDate: new Date(), method: 'bank', sourceType: 'leave_encashment', sourceId: existing.id,
    }, userId);
  }
}

/** Actually pays out an approved encashment - a separate step from approving it, same as a loan disbursal is separate from approving a loan. */
export async function payEncashment(scope: StoreScope, id: string, method: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.leaveEncashment.findFirst({ where: { id, storeId } });
  if (!existing) throw new StaffClaimError('Encashment request not found in your scope.');
  if (existing.status !== 'approved') throw new StaffClaimError('Only an approved encashment can be paid out.');

  const txn = await createStaffTransaction(scope, {
    userId: existing.userId, kind: 'expense_reimbursed', amountPaise: existing.amountPaise,
    txnDate: new Date(), method, sourceType: 'leave_encashment', sourceId: existing.id,
  }, userId);

  await db.leaveEncashment.update({ where: { id: existing.id }, data: { status: 'paid', payslipId: txn.id } });
}

// ------------------------------------------------------------ REIMBURSEMENT

export interface ReimbursementRow {
  id: string;
  userId: string;
  userName: string;
  category: string;
  amountPaise: number;
  expenseDate: Date;
  description: string | null;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export async function listReimbursements(scope: StoreScope): Promise<ReimbursementRow[]> {
  const rows = await db.reimbursementClaim.findMany({
    where: scopeWhere(scope),
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName, category: r.category,
    amountPaise: r.amountPaise, expenseDate: r.expenseDate, description: r.description,
    status: r.status, decidedAt: r.decidedAt, decisionNote: r.decisionNote, createdAt: r.createdAt,
  }));
}

export async function requestReimbursement(
  scope: StoreScope,
  input: { category: string; amountPaise: number; expenseDate: Date; description: string | null },
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.amountPaise <= 0) throw new StaffClaimError('Enter an amount greater than zero.');

  const claim = await db.reimbursementClaim.create({
    data: {
      storeId, userId, category: input.category, amountPaise: input.amountPaise,
      expenseDate: input.expenseDate, description: input.description?.trim() || null, requestedBy: userId,
    },
  });

  await raiseApproval(scope, 'reimbursement', claim.id, userId);
}

export async function decideReimbursement(
  scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const existing = await db.reimbursementClaim.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new StaffClaimError('Reimbursement claim not found in your scope.');
  if (existing.status !== 'pending') throw new StaffClaimError(`That claim was already ${existing.status}.`);

  const openRequest = await openApprovalRequest(scope, 'reimbursement', existing.id);
  let finalStatus: 'approved' | 'rejected' | null = decision;

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new StaffClaimError(e.message);
      throw e;
    }
    if (step.final === null) return;
    finalStatus = step.final === 'APPROVED' ? 'approved' : 'rejected';
  }

  await db.reimbursementClaim.update({
    where: { id: existing.id },
    data: { status: finalStatus, decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
  });

  // Approval recognises the liability - Dr Expense / Cr Staff Payable.
  // Rejecting a claim never touches the ledger.
  if (finalStatus === 'approved') {
    await createStaffTransaction(scope, {
      userId: existing.userId, kind: 'expense_claimed', amountPaise: existing.amountPaise,
      txnDate: existing.expenseDate, method: 'bank', sourceType: 'reimbursement_claim', sourceId: existing.id,
    }, userId);
  }
}

export async function payReimbursement(scope: StoreScope, id: string, method: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.reimbursementClaim.findFirst({ where: { id, storeId } });
  if (!existing) throw new StaffClaimError('Reimbursement claim not found in your scope.');
  if (existing.status !== 'approved') throw new StaffClaimError('Only an approved claim can be paid out.');

  const payoutTxn = await createStaffTransaction(scope, {
    userId: existing.userId, kind: 'expense_reimbursed', amountPaise: existing.amountPaise,
    txnDate: new Date(), method, sourceType: 'reimbursement_claim', sourceId: existing.id,
  }, userId);

  await db.reimbursementClaim.update({ where: { id: existing.id }, data: { status: 'paid', transactionId: payoutTxn.id } });
}
