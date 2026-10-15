'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  AdminError, applyBuiltOnlyMenus, getUserMenuOverrides, setRoleMenu, setStoreMenu, setUserMenu,
} from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

export interface MenuActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(
  run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string | void>,
): Promise<MenuActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change menu settings.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store - the menu is configured per branch.' };
    }
    const message = await run(ctx);
    revalidatePath('/settings/store-menu-config');
    revalidatePath('/', 'layout');
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[menu-config] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function toggleStoreMenu(menuId: string, isEnabled: boolean): Promise<MenuActionState> {
  return guard(async (ctx) => {
    await setStoreMenu(ctx.scope, menuId, isEnabled);
  });
}

export async function toggleRoleMenu(
  roleId: string,
  menuId: string,
  isVisible: boolean,
): Promise<MenuActionState> {
  return guard(async (ctx) => {
    await setRoleMenu(ctx.scope, roleId, menuId, isVisible);
  });
}

export async function toggleUserMenu(
  userId: string,
  menuId: string,
  override: boolean | null,
): Promise<MenuActionState> {
  return guard(async (ctx) => {
    await setUserMenu(ctx.scope, userId, menuId, override);
  });
}

export async function loadUserOverridesAction(
  userId: string,
): Promise<{ overrides: Record<string, boolean> } | { error: string }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('settings.edit')) {
    return { error: 'You do not have permission to change menu settings.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store - the menu is configured per branch.' };
  }
  try {
    return { overrides: await getUserMenuOverrides(ctx.scope, userId) };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    console.error('[menu-config] load overrides failed', e);
    return { error: friendlyError(e) };
  }
}

/**
 * Switch every menu with a working screen on, and everything else off.
 *
 * The single most useful button on this screen. Forty of Atlas's fifty-eight
 * routes are placeholders; a client who clicks one finds nothing, and once
 * trust goes it does not come back for the parts that do work. This makes the
 * product honest in one click, and turning a menu back on is how a module
 * ships.
 *
 * The built-route list is passed in from the caller rather than inferred here,
 * because the route catalogue already knows which screens are real and this
 * module should not keep a second opinion.
 */
export async function showOnlyBuilt(builtRoutes: string[]): Promise<MenuActionState> {
  return guard(async (ctx) => {
    const { enabled, total } = await applyBuiltOnlyMenus(ctx.scope, builtRoutes);

    if (ctx.scope.kind === 'single') {
      await db.activityLog
        .create({
          data: {
            storeId: ctx.scope.storeId,
            userId: ctx.user.id,
            activityType: 'Update',
            entityType: 'MenuConfig',
            description: `Menu reset to built-only: ${enabled} of ${total} enabled`,
          },
        })
        .catch((e) => console.error('[menu-config] audit write failed (non-fatal)', e));
    }

    return `${enabled} of ${total} menus are now visible.`;
  });
}
