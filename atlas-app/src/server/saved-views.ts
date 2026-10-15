import 'server-only';
import { db } from './db';
import type { AppContext } from './context';
import { canShareViews } from '@/lib/levels';

/**
 * Saved list layouts - "Save this layout" (F1 UI standard, decision Q2).
 *
 * Everyone keeps their own; an admin may share one with a role, and every
 * user holding a role of that name anywhere in the business then sees it.
 * A view is only filters + sort + hidden columns - it never grants access to
 * anything: the list still applies the viewer's own permissions and branch.
 */

export interface SavedViewRow {
  id: string;
  name: string;
  query: string;
  hiddenColumns: string[];
  sharedRoleName: string | null;
  mine: boolean;
}

const MAX_PER_SCREEN = 30;

/** Keeps only what a view may carry: no paging, nothing but plain key=value text. */
export function cleanViewQuery(raw: string): string {
  const sp = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  sp.delete('page');
  sp.delete('open');
  const out = new URLSearchParams();
  for (const [k, v] of sp) {
    if (/^[a-z][a-zA-Z0-9_]{0,30}$/.test(k) && v.length <= 200) out.append(k, v);
  }
  return out.toString().slice(0, 1000);
}

export async function listSavedViews(ctx: AppContext, screenKey: string): Promise<SavedViewRow[]> {
  const rows = await db.savedView.findMany({
    where: {
      screenKey,
      OR: [
        { userId: ctx.user.id },
        { organizationId: ctx.organization.id, sharedRoleName: { in: ctx.roleNames } },
      ],
    },
    orderBy: [{ sharedRoleName: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, query: true, hiddenColumns: true, sharedRoleName: true, userId: true },
  });
  return rows.map(({ userId, ...r }) => ({ ...r, mine: userId === ctx.user.id }));
}

export async function saveView(ctx: AppContext, input: {
  screenKey: string; name: string; query: string; hiddenColumns: string[]; sharedRoleName?: string | null;
}): Promise<{ error?: string; id?: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: 'Give the view a name.' };
  if (!/^\/[a-z0-9/_-]{1,120}$/i.test(input.screenKey)) return { error: 'Unknown screen.' };

  const hiddenColumns = input.hiddenColumns.filter((c) => /^[A-Za-z0-9_]{1,40}$/.test(c)).slice(0, 50);
  let sharedRoleName: string | null = null;
  if (input.sharedRoleName) {
    if (!canShareViews(ctx.permissions)) return { error: 'Only an admin can share a view with a role.' };
    const role = await db.role.findFirst({
      where: { name: input.sharedRoleName, store: { organizationId: ctx.organization.id } },
      select: { name: true },
    });
    if (!role) return { error: 'That role does not exist in this business.' };
    sharedRoleName = role.name;
  }

  const count = await db.savedView.count({ where: { userId: ctx.user.id, screenKey: input.screenKey } });
  if (count >= MAX_PER_SCREEN) return { error: `You already have ${MAX_PER_SCREEN} views on this screen. Delete one first.` };

  const row = await db.savedView.create({
    data: {
      userId: ctx.user.id, organizationId: ctx.organization.id, screenKey: input.screenKey,
      name, query: cleanViewQuery(input.query), hiddenColumns, sharedRoleName,
    },
    select: { id: true },
  });
  return { id: row.id };
}

/** Only the person who saved a view can delete it. */
export async function deleteView(ctx: AppContext, id: string): Promise<{ error?: string }> {
  const res = await db.savedView.deleteMany({ where: { id, userId: ctx.user.id } });
  return res.count ? {} : { error: 'That view is not yours to delete.' };
}

/** Role names in this business, for the "share with" picker (admins only). */
export async function shareableRoles(ctx: AppContext): Promise<string[]> {
  if (!canShareViews(ctx.permissions)) return [];
  const roles = await db.role.findMany({
    where: { store: { organizationId: ctx.organization.id } },
    select: { name: true },
    distinct: ['name'],
    orderBy: { name: 'asc' },
  });
  return roles.map((r) => r.name);
}
