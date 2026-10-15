import 'server-only';
import type { AppContext } from './context';
import { canExportLists } from '@/lib/levels';
import { configFor } from './config';

/**
 * May this person export lists here? Office/admin level (decision Q1) and the
 * business has not switched exports off (web.export, F1a) - the same two
 * checks /api/list-export makes, for screens that export in the browser.
 */
export async function canExportHere(ctx: AppContext): Promise<boolean> {
  if (!canExportLists(ctx.permissions)) return false;
  try { return (await configFor(ctx)).on('web.export'); } catch { return false; }
}
