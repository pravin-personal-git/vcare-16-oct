import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';

/**
 * Who may correct attendance for whom.
 *
 * Everywhere else in this codebase, `attendance.edit` is a blanket yes/no:
 * anyone who holds it can correct anyone's shift in the store. That is fine
 * for a small team and wrong for one large enough to have a proxy-marking
 * policy of its own.
 *
 * This model NARROWS `attendance.edit`, it never widens it - `false` from
 * `canMarkAttendanceFor` always wins over anything below. And it is opt-in
 * per store: `restrictToRules` defaults false, so a store that never opens
 * this screen behaves exactly as it did before this file existed.
 */

export interface MarkPolicyView {
  restrictToRules: boolean;
  selfMarkingEnabled: boolean;
  managerMarksReports: boolean;
  roleIds: string[];
  userIds: string[];
  updatedAt: Date | null;
}

const DEFAULTS: Omit<MarkPolicyView, 'updatedAt'> = {
  restrictToRules: false,
  selfMarkingEnabled: true,
  managerMarksReports: true,
  roleIds: [],
  userIds: [],
};

export class MarkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkPolicyError';
  }
}

async function policyForStore(storeId: string): Promise<MarkPolicyView> {
  const row = await db.attendanceMarkPolicy.findUnique({ where: { storeId } });
  if (!row) return { ...DEFAULTS, updatedAt: null };

  return {
    restrictToRules: row.restrictToRules,
    selfMarkingEnabled: row.selfMarkingEnabled,
    managerMarksReports: row.managerMarksReports,
    roleIds: row.roleIds,
    userIds: row.userIds,
    updatedAt: row.updatedAt,
  };
}

/** For the admin screen, which always operates on one selected branch. */
export async function getMarkPolicy(scope: StoreScope): Promise<MarkPolicyView> {
  return policyForStore(scopeForWrite(scope));
}

export interface MarkPolicyInput {
  restrictToRules: boolean;
  selfMarkingEnabled: boolean;
  managerMarksReports: boolean;
  roleIds: string[];
  userIds: string[];
}

export async function saveMarkPolicy(
  scope: StoreScope,
  input: MarkPolicyInput,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (input.restrictToRules
    && !input.selfMarkingEnabled
    && !input.managerMarksReports
    && input.roleIds.length === 0
    && input.userIds.length === 0
  ) {
    throw new MarkPolicyError(
      'That would let nobody correct attendance for anyone else - not even a manager for their own team. Allow at least one path before turning restriction on.',
    );
  }

  const data = {
    restrictToRules: input.restrictToRules,
    selfMarkingEnabled: input.selfMarkingEnabled,
    managerMarksReports: input.managerMarksReports,
    roleIds: input.roleIds,
    userIds: input.userIds,
    updatedBy: userId,
  };

  await db.attendanceMarkPolicy.upsert({
    where: { storeId },
    create: { storeId, ...data },
    update: data,
  });
}

/**
 * Walk up from `targetUserId` through `reportsToId`, looking for `managerId`.
 *
 * Same cycle-safety as `hierarchy.ts`'s `setReportsTo` - a pre-existing loop
 * in the reporting line must not hang an attendance correction.
 */
async function reportsUpTo(targetUserId: string, managerId: string): Promise<boolean> {
  const seen = new Set<string>([targetUserId]);
  let cursor: string | null = targetUserId;

  while (cursor) {
    const row: { reportsToId: string | null } | null = await db.user.findUnique({
      where: { id: cursor },
      select: { reportsToId: true },
    });
    cursor = row?.reportsToId ?? null;
    if (!cursor) return false;
    if (cursor === managerId) return true;
    if (seen.has(cursor)) return false; // pre-existing loop; give up rather than spin
    seen.add(cursor);
  }
  return false;
}

/**
 * Can `actor` correct `targetUserId`'s attendance?
 *
 * `attendance.edit` is checked by every caller before this runs - this
 * function only narrows who among edit-holders may touch someone ELSE's
 * record. It never grants anything `attendance.edit` did not already.
 *
 * Takes the record's own `storeId` rather than the actor's ambient scope -
 * a correction reachable in "All Company" mode still belongs to whichever
 * branch the shift was actually clocked in at, not a guess at "the first
 * store this user can see".
 */
export async function canMarkAttendanceFor(
  storeId: string,
  actor: { id: string },
  targetUserId: string,
): Promise<boolean> {
  const policy = await policyForStore(storeId);

  // Legacy behaviour: any attendance.edit holder may mark anyone, including
  // themselves - this is what every store did before this model existed.
  if (!policy.restrictToRules) return true;

  if (actor.id === targetUserId) return policy.selfMarkingEnabled;

  if (policy.managerMarksReports && await reportsUpTo(targetUserId, actor.id)) return true;

  if (policy.userIds.includes(actor.id)) return true;

  if (policy.roleIds.length > 0) {
    const held = await db.userStoreRole.findFirst({
      where: { userId: actor.id, storeId, roleId: { in: policy.roleIds } },
      select: { roleId: true },
    });
    if (held) return true;
  }

  return false;
}
