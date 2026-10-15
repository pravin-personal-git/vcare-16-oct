import 'server-only';
import { isPageOff } from '@/lib/modules';
import { db } from './db';
import type { AppContext } from './context';
import { levelFor } from './handbook-content';
import { renderHandbook } from './handbook-render';
import { renderSop } from './sop-render';

/**
 * The handbook for the person signed in: their level comes from their
 * permissions, and the "moving from the old app" chapters appear only for a
 * business that was migrated (it has complaints carrying an old number).
 */
export async function handbookFor(ctx: AppContext, mode: 'app' | 'file', origin: string): Promise<string> {
  const migrated = ctx.stores.length > 0 && !!(await db.complaint.findFirst({
    where: { storeId: { in: ctx.stores.map((s) => s.id) }, legacyRef: { not: null } },
    select: { id: true },
  }));
  return renderHandbook({
    level: levelFor(ctx.permissions),
    migrated,
    orgName: ctx.organization.name,
    mode,
    origin,
    // Chapters about a module switched off for this business are left out (F-01).
    isOff: (href) => isPageOff(href, ctx.excludedModules, ctx.excludedPages),
  });
}

/**
 * The SOP guidebook ("ek din ka business") for the person signed in - same
 * level rule as the handbook, and steps about switched-off modules left out.
 */
export function sopGuideFor(ctx: AppContext, mode: 'app' | 'file', origin: string): string {
  return renderSop({
    level: levelFor(ctx.permissions),
    orgName: ctx.organization.name,
    mode,
    origin,
    isOff: (href) => isPageOff(href, ctx.excludedModules, ctx.excludedPages),
  });
}
