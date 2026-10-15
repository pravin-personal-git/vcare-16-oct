'use server';

import { requireContext } from '@/server/context';
import { deleteView, listSavedViews, saveView, shareableRoles, type SavedViewRow } from '@/server/saved-views';

/** Saved list layouts for the FilterBar's "Views" menu (F1 UI standard). */

export async function listSavedViewsAction(screenKey: string): Promise<SavedViewRow[]> {
  const ctx = await requireContext();
  return listSavedViews(ctx, screenKey);
}

export async function saveViewAction(input: {
  screenKey: string; name: string; query: string; hiddenColumns: string[]; sharedRoleName?: string | null;
}): Promise<{ error?: string; id?: string }> {
  const ctx = await requireContext();
  return saveView(ctx, input);
}

export async function deleteViewAction(id: string): Promise<{ error?: string }> {
  const ctx = await requireContext();
  return deleteView(ctx, id);
}

/**
 * The roles a view may be shared with.
 *
 * Fetched client-side by `ListFilter`, which - unlike `FilterBar` - is dropped
 * into screens that do not otherwise load anything for their filters. Adding a
 * `shareableRoles` call to thirty page files to pass one string array down
 * would be a lot of plumbing for a dropdown.
 */
export async function shareableRolesAction(): Promise<string[]> {
  const ctx = await requireContext();
  return shareableRoles(ctx);
}
