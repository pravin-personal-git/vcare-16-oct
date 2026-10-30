'use server';

import { requireContext } from '@/server/context';
import { HELP } from '@/server/help-content';
import { LEVELS, levelFor } from '@/lib/levels';
import { isPageOff } from '@/lib/modules';
import type { HelpArticle } from '@/lib/help/search';

/**
 * The help chat's guides for the person asking (30 Oct 2026): only up to their
 * level, the admin guides never (they belong to the admin mode, built later),
 * and none about a page switched off for this business - like the handbook.
 */
export async function helpLibraryAction(): Promise<{ level: string; articles: HelpArticle[] }> {
  const ctx = await requireContext();
  const level = levelFor(ctx.permissions);
  const mine = LEVELS.indexOf(level);
  const off = (href?: string) => !!href && isPageOff(href.split('?')[0], ctx.excludedModules, ctx.excludedPages);
  const articles = HELP.filter((a) => a.level !== 'admin' && LEVELS.indexOf(a.level) <= mine && !off(a.open?.href) && !a.steps.some((s) => off(s.href)));
  return { level, articles };
}
