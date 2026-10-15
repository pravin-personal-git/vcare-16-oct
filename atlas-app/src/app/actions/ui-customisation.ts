'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { friendlyError } from '@/lib/friendly-error';
import { CUSTOMISABLE_PAGES, type CustomisablePage, type CustomiseScope } from '@/lib/page-customise';

/** Customise page - save / reset (11 Oct 2026). Admins only; checked again in the server module. */
const ROUTE: Record<CustomisablePage, string> = { 'services.board': '/services/board' };

export async function saveCustomisationAction(
  page: string, scope: CustomiseScope, roleId: string | null, value: unknown,
): Promise<{ ok?: true; error?: string }> {
  try {
    if (!(page in CUSTOMISABLE_PAGES)) return { error: 'This page cannot be customised.' };
    const ctx = await requireContext();
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). Each branch keeps its own layout.' };
    const { saveCustomisation } = await import('@/server/ui-customisation');
    await saveCustomisation(ctx, page as CustomisablePage, { scope, roleId, value });
    revalidatePath(ROUTE[page as CustomisablePage]);
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function resetCustomisationAction(
  page: string, scope: CustomiseScope, roleId: string | null,
): Promise<{ ok?: true; error?: string }> {
  try {
    if (!(page in CUSTOMISABLE_PAGES)) return { error: 'This page cannot be customised.' };
    const ctx = await requireContext();
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar).' };
    const { resetCustomisation } = await import('@/server/ui-customisation');
    await resetCustomisation(ctx, page as CustomisablePage, { scope, roleId });
    revalidatePath(ROUTE[page as CustomisablePage]);
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
