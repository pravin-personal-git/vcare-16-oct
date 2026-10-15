import 'server-only';
import { db } from './db';
import { type StoreScope, scopeForWrite, scopeWhere } from './store-scope';
import { listAssignableUsers } from './assets';
import { isBlockActive } from '@/lib/discipline';

/**
 * "Policies & Discipline" (roadmap §4.2) - the DISCIPLINE half.
 *
 * Distinct from `InternalPolicy` (documents staff read and acknowledge, in
 * Common Hub) - confirmed against atlas-hrns's real `employee/models.py`
 * (`Actiontype`/`DisciplinaryAction`), which corrected an earlier roadmap
 * guess that this was just a category field on `InternalPolicy`. No file
 * attachment support yet (atlas-hrns's `DisciplinaryAction.attachment`) -
 * `attachments.ts`'s `DocType` union is scoped to sales documents today;
 * widening it is a separate, small follow-up, not bundled in here.
 */

export class DisciplineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisciplineError';
  }
}

export const ACTION_KINDS = ['warning', 'suspension', 'dismissal'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// --------------------------------------------------------------- action types

export interface ActionTypeRow {
  id: string;
  title: string;
  actionKind: ActionKind;
  blockLogin: boolean;
  isActive: boolean;
}

export async function listActionTypes(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<ActionTypeRow[]> {
  const rows = await db.disciplinaryActionType.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { title: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, actionKind: r.actionKind as ActionKind,
    blockLogin: r.blockLogin, isActive: r.isActive,
  }));
}

export interface ActionTypeInput {
  title: string;
  actionKind: ActionKind;
  blockLogin: boolean;
}

function validateActionTypeInput(input: ActionTypeInput): { title: string; actionKind: ActionKind } {
  const title = input.title.trim();
  if (!title) throw new DisciplineError('Give this action type a title.');
  if (!ACTION_KINDS.includes(input.actionKind)) throw new DisciplineError('Unknown action kind.');
  return { title, actionKind: input.actionKind };
}

export async function saveActionType(scope: StoreScope, id: string | null, input: ActionTypeInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  const { title, actionKind } = validateActionTypeInput(input);

  if (id) {
    const existing = await db.disciplinaryActionType.findFirst({ where: { id, storeId } });
    if (!existing) throw new DisciplineError('That action type is not in your scope.');
    await db.disciplinaryActionType.update({
      where: { id }, data: { title, actionKind, blockLogin: input.blockLogin },
    });
    return;
  }

  const last = await db.disciplinaryActionType.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
  await db.disciplinaryActionType.create({
    data: { storeId, title, actionKind, blockLogin: input.blockLogin, sort: (last?.sort ?? 0) + 1 },
  });
}

/** Deactivated, not deleted - past disciplinary actions keep meaning what they meant. */
export async function removeActionType(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.disciplinaryActionType.findFirst({ where: { id, storeId } });
  if (!existing) throw new DisciplineError('That action type is not in your scope.');
  await db.disciplinaryActionType.update({ where: { id }, data: { isActive: false } });
}

// ------------------------------------------------------------------- actions

export interface DisciplinaryActionRow {
  id: string;
  userId: string;
  userName: string;
  actionTypeId: string;
  actionTypeTitle: string;
  actionKind: ActionKind;
  description: string;
  startDate: Date;
  durationDays: number | null;
  isCurrentlyBlocking: boolean;
  createdAt: Date;
}

export async function listDisciplinaryActions(scope: StoreScope): Promise<DisciplinaryActionRow[]> {
  const rows = await db.disciplinaryAction.findMany({
    where: scopeWhere(scope),
    orderBy: { startDate: 'desc' },
    include: { user: { select: { fullName: true } }, actionType: { select: { title: true, actionKind: true, blockLogin: true } } },
  });
  const now = new Date();
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName,
    actionTypeId: r.actionTypeId, actionTypeTitle: r.actionType.title, actionKind: r.actionType.actionKind as ActionKind,
    description: r.description, startDate: r.startDate, durationDays: r.durationDays,
    isCurrentlyBlocking: r.actionType.blockLogin && isBlockActive({ startDate: r.startDate, durationDays: r.durationDays }, now),
    createdAt: r.createdAt,
  }));
}

export interface DisciplinaryActionInput {
  userId: string;
  actionTypeId: string;
  description: string;
  startDate: Date;
  durationDays: number | null;
}

export async function listDisciplineEmployees(scope: StoreScope) {
  return listAssignableUsers(scope);
}

export async function createDisciplinaryAction(scope: StoreScope, input: DisciplinaryActionInput, createdBy: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const description = input.description.trim();
  if (!description) throw new DisciplineError('Describe what happened.');

  if (input.durationDays !== null) {
    const days = Math.trunc(input.durationDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      throw new DisciplineError('Duration must be between 1 and 365 days, or left blank for no defined end.');
    }
  }

  const [actionType, holdsRole] = await Promise.all([
    db.disciplinaryActionType.findFirst({ where: { id: input.actionTypeId, storeId } }),
    db.userStoreRole.findFirst({ where: { storeId, userId: input.userId } }),
  ]);
  if (!actionType) throw new DisciplineError('That action type is not in your scope.');
  if (!holdsRole) throw new DisciplineError('That person does not have access to this store.');

  await db.disciplinaryAction.create({
    data: {
      storeId, userId: input.userId, actionTypeId: input.actionTypeId,
      description, startDate: input.startDate, durationDays: input.durationDays, createdBy,
    },
  });
}

/**
 * Called from `login/actions.ts`, right next to the existing `user.isActive`
 * check - same shape, same job: deny sign-in with a clear reason. Organi-
 * sation-wide, not store-scoped, because a login either works or it
 * doesn't; it is not the current store selection's business which branch
 * issued the block.
 */
export async function activeLoginBlock(userId: string): Promise<{ actionKind: ActionKind; title: string } | null> {
  const rows = await db.disciplinaryAction.findMany({
    where: { userId, actionType: { blockLogin: true } },
    select: { startDate: true, durationDays: true, actionType: { select: { title: true, actionKind: true } } },
  });
  const now = new Date();
  const active = rows.find((r) => isBlockActive({ startDate: r.startDate, durationDays: r.durationDays }, now));
  return active ? { actionKind: active.actionType.actionKind as ActionKind, title: active.actionType.title } : null;
}
