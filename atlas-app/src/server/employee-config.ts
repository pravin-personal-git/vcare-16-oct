import 'server-only';
import { db } from './db';
import { type StoreScope, scopeForWrite, scopeWhere } from './store-scope';
import { listAssignableUsers } from './assets';
import { TAG_COLOR_TOKENS, type TagColorToken } from '@/lib/tag-colors';

/**
 * Employee Configuration (roadmap §4.2) - `EmployeeTypeTag` and
 * `EmployeeTag`, modeled on atlas-hrns's real `EmployeeType`
 * (`base/models.py:732`) and `Tags` (`base/models.py:1986`).
 *
 * Both are purely descriptive - see the long comment on
 * `EmployeeProfile.employeeTypeTagId` in schema.prisma for why this is
 * deliberately separate from the `employmentType` enum payroll conditions
 * already depend on.
 */

export class EmployeeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeConfigError';
  }
}

// ------------------------------------------------------------- employee type

export interface EmployeeTypeRow {
  id: string;
  label: string;
  isActive: boolean;
}

export async function listEmployeeTypes(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<EmployeeTypeRow[]> {
  const rows = await db.employeeTypeTag.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, label: r.label, isActive: r.isActive }));
}

export async function saveEmployeeType(scope: StoreScope, id: string | null, label: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const trimmed = label.trim();
  if (!trimmed) throw new EmployeeConfigError('Give this employee type a label.');

  if (id) {
    const existing = await db.employeeTypeTag.findFirst({ where: { id, storeId } });
    if (!existing) throw new EmployeeConfigError('That employee type is not in your scope.');
    await db.employeeTypeTag.update({ where: { id }, data: { label: trimmed } });
    return;
  }

  const last = await db.employeeTypeTag.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
  await db.employeeTypeTag.create({ data: { storeId, label: trimmed, sort: (last?.sort ?? 0) + 1 } });
}

export async function removeEmployeeType(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.employeeTypeTag.findFirst({ where: { id, storeId } });
  if (!existing) throw new EmployeeConfigError('That employee type is not in your scope.');
  await db.employeeTypeTag.update({ where: { id }, data: { isActive: false } });
}

// -------------------------------------------------------------- employee tag

export interface EmployeeTagRow {
  id: string;
  label: string;
  color: string;
  isActive: boolean;
}

export async function listEmployeeTags(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<EmployeeTagRow[]> {
  const rows = await db.employeeTag.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, label: r.label, color: r.color, isActive: r.isActive }));
}

export async function saveEmployeeTag(scope: StoreScope, id: string | null, input: { label: string; color: string }): Promise<void> {
  const storeId = scopeForWrite(scope);
  const label = input.label.trim();
  if (!label) throw new EmployeeConfigError('Give this tag a label.');
  if (!TAG_COLOR_TOKENS.includes(input.color as TagColorToken)) throw new EmployeeConfigError('Pick a valid colour.');

  if (id) {
    const existing = await db.employeeTag.findFirst({ where: { id, storeId } });
    if (!existing) throw new EmployeeConfigError('That tag is not in your scope.');
    await db.employeeTag.update({ where: { id }, data: { label, color: input.color } });
    return;
  }

  const last = await db.employeeTag.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
  await db.employeeTag.create({ data: { storeId, label, color: input.color, sort: (last?.sort ?? 0) + 1 } });
}

export async function removeEmployeeTag(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.employeeTag.findFirst({ where: { id, storeId } });
  if (!existing) throw new EmployeeConfigError('That tag is not in your scope.');
  await db.employeeTag.update({ where: { id }, data: { isActive: false } });
}

// -------------------------------------------------------------- assignment

export interface EmployeeConfigAssignmentRow {
  userId: string;
  userName: string;
  employeeTypeTagId: string | null;
  employeeTypeTagLabel: string | null;
  tagIds: string[];
}

export async function listEmployeeConfigAssignments(scope: StoreScope): Promise<EmployeeConfigAssignmentRow[]> {
  const employees = await listAssignableUsers(scope);
  const profiles = await db.employeeProfile.findMany({
    where: { userId: { in: employees.map((e) => e.id) } },
    select: { userId: true, employeeTypeTag: { select: { id: true, label: true } }, tags: { select: { id: true } } },
  });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return employees.map((e) => {
    const p = profileByUser.get(e.id);
    return {
      userId: e.id, userName: e.fullName,
      employeeTypeTagId: p?.employeeTypeTag?.id ?? null, employeeTypeTagLabel: p?.employeeTypeTag?.label ?? null,
      tagIds: p?.tags.map((t) => t.id) ?? [],
    };
  });
}

export async function assignEmployeeConfig(
  scope: StoreScope, userId: string, input: { employeeTypeTagId: string | null; tagIds: string[] },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new EmployeeConfigError('That person does not have access to this store.');

  if (input.employeeTypeTagId) {
    const type = await db.employeeTypeTag.findFirst({ where: { id: input.employeeTypeTagId, storeId } });
    if (!type) throw new EmployeeConfigError('That employee type is not in your scope.');
  }
  if (input.tagIds.length > 0) {
    const count = await db.employeeTag.count({ where: { id: { in: input.tagIds }, storeId } });
    if (count !== input.tagIds.length) throw new EmployeeConfigError('One of those tags is not in your scope.');
  }

  await db.employeeProfile.upsert({
    where: { userId },
    create: { userId, employeeTypeTagId: input.employeeTypeTagId, tags: { connect: input.tagIds.map((id) => ({ id })) } },
    update: { employeeTypeTagId: input.employeeTypeTagId, tags: { set: input.tagIds.map((id) => ({ id })) } },
  });
}
