import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite } from './store-scope';
import type { AppContext } from './context';
import {
  cleanCustomisation, EMPTY_CUSTOMISATION, type CustomisablePage, type CustomiseScope, type PageCustomisation,
} from '@/lib/page-customise';

/**
 * Page customisation an admin set (11 Oct 2026, ops-pages demo tab 7).
 *
 * Read order: this user's own -> one of their roles' -> everyone's -> the
 * page's defaults. The first one found is used whole, so "only me" really
 * is only me and a role layout is not half-mixed with everyone's.
 */
export interface CustomisationView {
  value: PageCustomisation;
  /** Which layer it came from - shown to the admin in customise mode. */
  from: CustomiseScope | 'default';
  canCustomise: boolean;
  /** The branch's roles, for "Save for a role". Admins only. */
  roles: { id: string; name: string }[];
}

export async function customisationFor(ctx: AppContext, page: CustomisablePage): Promise<CustomisationView> {
  const canCustomise = ctx.permissions.has('settings.edit') && ctx.scope.kind === 'single';
  if (ctx.scope.kind !== 'single') return { value: EMPTY_CUSTOMISATION, from: 'default', canCustomise: false, roles: [] };
  const storeId = ctx.scope.storeId;

  const [rows, mine, roles] = await Promise.all([
    db.uiCustomisation.findMany({ where: { storeId, page }, select: { scope: true, roleId: true, userId: true, json: true } }),
    db.userStoreRole.findMany({ where: { storeId, userId: ctx.user.id }, select: { roleId: true } }),
    canCustomise ? db.role.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
  ]);
  const myRoles = new Set(mine.map((r) => r.roleId));
  const pick = rows.find((r) => r.scope === 'user' && r.userId === ctx.user.id)
    ?? rows.find((r) => r.scope === 'role' && r.roleId && myRoles.has(r.roleId))
    ?? rows.find((r) => r.scope === 'everyone');
  return {
    value: pick ? cleanCustomisation(pick.json, page) : EMPTY_CUSTOMISATION,
    from: pick ? (pick.scope as CustomiseScope) : 'default',
    canCustomise,
    roles,
  };
}

export async function saveCustomisation(
  ctx: AppContext,
  page: CustomisablePage,
  input: { scope: CustomiseScope; roleId?: string | null; value: unknown },
): Promise<void> {
  if (!ctx.permissions.has('settings.edit')) throw new Error('Only an admin can customise a page.');
  const storeId = scopeForWrite(ctx.scope);
  const scope: CustomiseScope = input.scope === 'role' || input.scope === 'user' ? input.scope : 'everyone';
  let roleId: string | null = null;
  if (scope === 'role') {
    const role = input.roleId ? await db.role.findFirst({ where: { id: input.roleId, storeId }, select: { id: true } }) : null;
    if (!role) throw new Error('Pick a role of this branch.');
    roleId = role.id;
  }
  const userId = scope === 'user' ? ctx.user.id : null;
  const json = cleanCustomisation(input.value, page) as unknown as Prisma.InputJsonValue;

  const existing = await db.uiCustomisation.findFirst({ where: { storeId, page, scope, roleId, userId }, select: { id: true } });
  if (existing) {
    await db.uiCustomisation.update({ where: { id: existing.id }, data: { json, updatedBy: ctx.user.id, version: { increment: 1 } } });
  } else {
    await db.uiCustomisation.create({ data: { storeId, page, scope, roleId, userId, json, updatedBy: ctx.user.id } });
  }
}

/** Back to the layer below: removes this scope's layout (tombstoned, with a name). */
export async function resetCustomisation(
  ctx: AppContext, page: CustomisablePage, input: { scope: CustomiseScope; roleId?: string | null },
): Promise<void> {
  if (!ctx.permissions.has('settings.edit')) throw new Error('Only an admin can customise a page.');
  const storeId = scopeForWrite(ctx.scope);
  await db.uiCustomisation.updateMany({
    where: {
      storeId, page, scope: input.scope,
      roleId: input.scope === 'role' ? input.roleId ?? undefined : null,
      userId: input.scope === 'user' ? ctx.user.id : null,
    },
    data: { deletedAt: new Date(), deletedBy: ctx.user.id },
  });
}
