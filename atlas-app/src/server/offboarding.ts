import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { generateTasksForUser, listTasksForUser, summarizeProgress, type PhaseProgress } from './lifecycle';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { createStaffTransaction, recoverableAdvances } from './staff-accounts';
import { formatCurrency } from '@/lib/format';

export class OffboardingError extends Error {}

export interface ResignationRow {
  id: string;
  userId: string;
  userName: string;
  reason: string | null;
  noticeDays: number;
  resignedOn: Date;
  lastWorkingDay: Date;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  completedAt: Date | null;
  progress: PhaseProgress | null;
}

/**
 * `canViewAll` (holds `hrm.view` or `hrm.edit`) sees the whole store's
 * resignations; everyone else sees only their own - a resignation reason
 * can be sensitive, the same reasoning Helpdesk uses for ticket visibility.
 */
export async function listResignations(
  scope: StoreScope, viewer: { userId: string; canViewAll: boolean },
): Promise<ResignationRow[]> {
  const rows = await db.resignation.findMany({
    where: { ...scopeWhere(scope), ...(viewer.canViewAll ? {} : { userId: viewer.userId }) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { user: { select: { fullName: true } } },
    take: LIST_MAX_ROWS,
  });

  const accepted = rows.filter((r) => r.status !== 'submitted' && r.status !== 'rejected');
  const tasksByUser = new Map<string, PhaseProgress>();
  await Promise.all(accepted.map(async (r) => {
    const tasks = await listTasksForUser(scope, r.userId, 'offboarding');
    tasksByUser.set(r.userId, summarizeProgress(tasks));
  }));

  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName, reason: r.reason,
    noticeDays: r.noticeDays, resignedOn: r.resignedOn, lastWorkingDay: r.lastWorkingDay,
    status: r.status, decidedAt: r.decidedAt, decisionNote: r.decisionNote, completedAt: r.completedAt,
    progress: tasksByUser.get(r.userId) ?? null,
  }));
}

/** Any employee resigning their own position - self-service, no permission required, same as a leave request. */
export async function submitResignation(
  scope: StoreScope, input: { reason: string | null; noticeDays: number; lastWorkingDay: Date }, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.noticeDays < 0) throw new OffboardingError('Notice period cannot be negative.');

  const existing = await db.resignation.findFirst({ where: { storeId, userId, status: 'submitted' } });
  if (existing) throw new OffboardingError('You already have a resignation awaiting a decision.');

  const resignation = await db.resignation.create({
    data: {
      storeId, userId, reason: input.reason?.trim() || null,
      noticeDays: input.noticeDays, lastWorkingDay: input.lastWorkingDay,
    },
  });

  await raiseApproval(scope, 'resignation', resignation.id, userId);
}

/**
 * Decide a pending resignation - the same "chain if configured, direct if
 * not" shape as `decideLeaveRequest`/`decideAssetRequest`. Accepting
 * immediately generates the offboarding checklist tasks - there's no
 * separate "start offboarding" step, unlike Onboarding, because acceptance
 * IS the trigger; nothing else has to happen first.
 */
export async function decideResignation(
  scope: StoreScope, resignationId: string, decision: 'accepted' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const existing = await db.resignation.findFirst({ where: { id: resignationId, ...scopeWhere(scope) } });
  if (!existing) throw new OffboardingError('Resignation not found in your scope.');
  if (existing.status !== 'submitted') throw new OffboardingError(`That resignation was already ${existing.status}.`);

  const openRequest = await openApprovalRequest(scope, 'resignation', existing.id);
  let finalStatus: 'accepted' | 'rejected' | null = decision;

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision === 'accepted' ? 'approved' : 'rejected', userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new OffboardingError(e.message);
      throw e;
    }
    if (step.final === null) return; // more levels still to clear
    finalStatus = step.final === 'APPROVED' ? 'accepted' : 'rejected';
  }

  await db.resignation.update({
    where: { id: existing.id },
    data: { status: finalStatus, decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
  });

  if (finalStatus === 'accepted') {
    await generateTasksForUser(scope, existing.userId, 'offboarding');
  }
}

/**
 * Close out an accepted resignation: records the exit on the employee's
 * profile and deactivates their login. Callable regardless of whether
 * every offboarding step is ticked off - a business may need someone gone
 * on their last working day even if the laptop hasn't been returned yet,
 * and that outstanding step stays visible on the checklist either way.
 */
/**
 * FULL AND FINAL: what is still open between the business and somebody who
 * is leaving (8 Oct 2026, G-19).
 *
 * Offboarding used to finish without looking at money at all. An outstanding
 * loan or advance stayed on `1400 Staff Advances` against a person who no
 * longer worked there and whose login had just been switched off - nobody
 * found out until somebody read the Staff Balance screen months later.
 *
 * Three separate figures, because they are settled in three different ways:
 *   loanPaise      - a `StaffLoan` with a schedule. Recover it on the final
 *                    payslip, settle it in cash, or write it off.
 *   advancePaise   - plain advances with no schedule, from the one shared
 *                    `recoverableAdvances`, so this agrees with payroll and
 *                    the Staff Balance screen.
 *   owedToThemPaise- expense claims approved and never reimbursed. The
 *                    business owes THIS one, and it must be paid before the
 *                    person goes, not netted off quietly against what they
 *                    owe: a reimbursement and a loan are different debts
 *                    with different reasons.
 */
export interface StaffSettlement {
  loanPaise: number;
  advancePaise: number;
  owedToThemPaise: number;
  /** Nothing left to settle in either direction. */
  clear: boolean;
}

export async function settlementFor(scope: StoreScope, userId: string): Promise<StaffSettlement> {
  const [loans, advances, claims] = await Promise.all([
    db.staffLoan.findMany({
      where: { ...scopeWhere(scope), userId, status: 'active' },
      select: {
        principalPaise: true,
        repayments: { where: { deletedAt: null }, select: { amountPaise: true } },
      },
    }),
    recoverableAdvances(scope, [userId]),
    db.staffTransaction.findMany({
      where: {
        ...scopeWhere(scope), userId, status: 'active',
        kind: { in: ['expense_claimed', 'expense_reimbursed'] },
      },
      select: { kind: true, amountPaise: true },
    }),
  ]);

  const loanPaise = loans.reduce(
    (n, l) => n + Math.max(0, l.principalPaise - l.repayments.reduce((m, r) => m + r.amountPaise, 0)), 0,
  );
  const advancePaise = advances.get(userId) ?? 0;
  const owedToThemPaise = Math.max(0, claims.reduce(
    (n, c) => n + (c.kind === 'expense_claimed' ? c.amountPaise : -c.amountPaise), 0,
  ));

  return {
    loanPaise, advancePaise, owedToThemPaise,
    clear: loanPaise === 0 && advancePaise === 0 && owedToThemPaise === 0,
  };
}

/**
 * Stop chasing what a leaver owes, with a reason on the record.
 *
 * Posts through `createStaffTransaction` (`advance_written_off`:
 * Dr 5900 Other Operating Expenses / Cr 1400 Staff Advances) rather than as a
 * bare journal entry, so the Staff Balance screen - which reads those rows -
 * actually shows the debt clearing. Any active loan is marked `written_off`,
 * the status its own schema comment has always described.
 *
 * It is a COST, not a payment: no cash moves, and `listUserAccounts` counts it
 * separately from `totalPayments` for that reason.
 */
export async function writeOffStaffDues(
  scope: StoreScope, userId: string, reason: string, byUserId: string,
): Promise<{ writtenOffPaise: number }> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new OffboardingError('Say why this is being written off.');

  const settlement = await settlementFor(scope, userId);
  const writtenOffPaise = settlement.loanPaise + settlement.advancePaise;
  if (writtenOffPaise <= 0) throw new OffboardingError('There is nothing outstanding to write off.');

  await createStaffTransaction(scope, {
    userId, kind: 'advance_written_off', amountPaise: writtenOffPaise,
    txnDate: new Date(), method: 'cash', note: reason.trim(),
    sourceType: 'offboarding_writeoff', sourceId: userId,
  }, byUserId);

  await db.staffLoan.updateMany({
    where: { storeId, userId, status: 'active' },
    data: { status: 'written_off' },
  });

  return { writtenOffPaise };
}

export async function completeOffboarding(scope: StoreScope, resignationId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const resignation = await db.resignation.findFirst({ where: { id: resignationId, storeId } });
  if (!resignation) throw new OffboardingError('Resignation not found in your scope.');
  if (resignation.status !== 'accepted') throw new OffboardingError('Only an accepted resignation can be completed.');

  // Full and final before the login goes off (G-19). Completing used to
  // switch the account off and leave the money hanging against somebody who
  // no longer works here.
  const settlement = await settlementFor(scope, resignation.userId);
  if (!settlement.clear) {
    const parts: string[] = [];
    if (settlement.loanPaise > 0) parts.push(`a loan of ${formatCurrency(settlement.loanPaise)}`);
    if (settlement.advancePaise > 0) parts.push(`an advance of ${formatCurrency(settlement.advancePaise)}`);
    if (settlement.owedToThemPaise > 0) parts.push(`${formatCurrency(settlement.owedToThemPaise)} of expense claims the business still owes them`);
    throw new OffboardingError(
      `Settle the account first - there is still ${parts.join(', ')}. `
      + 'Recover it on the final payslip, settle it in cash on the Staff Balance screen, '
      + 'or write it off with a reason.',
    );
  }

  await db.$transaction([
    db.resignation.update({ where: { id: resignationId }, data: { status: 'completed', completedAt: new Date() } }),
    db.employeeProfile.upsert({
      where: { userId: resignation.userId },
      create: { userId: resignation.userId, exitDate: new Date(), exitReason: resignation.reason },
      update: { exitDate: new Date(), exitReason: resignation.reason },
    }),
    db.user.update({ where: { id: resignation.userId }, data: { isActive: false } }),
  ]);
}

export { listTasksForUser as listOffboardingTasks };
