import { NextResponse } from 'next/server';
import { isPageOff } from '@/lib/modules';
import { getContext } from '@/server/context';
import { globalSearch } from '@/server/search';
import { salesReach } from '@/server/sales-reach';
import { menuHides } from '@/lib/menu-gate';

/**
 * Record search for the command palette.
 *
 * A ROUTE RATHER THAN A SERVER ACTION, DELIBERATELY.
 *
 * This fires on every keystroke after a debounce. Server actions are POSTs that
 * go through Next's action pipeline and revalidation machinery - correct for a
 * write, needless weight for a read that happens twenty times while somebody
 * types a customer's name.
 *
 * Scoped by the caller's session like every other read. Returns an empty list
 * rather than a 401 when signed out: the palette is a convenience, and a
 * failing fetch in the corner of the screen is worse than nothing appearing.
 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ hits: [] });

  const q = new URL(req.url).searchParams.get('q') ?? '';

  try {
    // Records of a module switched off for this business are not found (F-01).
    // Only their own (or team's) quotations, orders and invoices (B4 step 3);
    // and nothing from a page hidden in their menu - hidden means no search
    // result either (B1, decision P1).
    const hits = (await globalSearch(ctx.scope, q, await salesReach(ctx)))
      .filter((h) => !isPageOff(h.route, ctx.excludedModules, ctx.excludedPages))
      .filter((h) => ctx.impersonation || !ctx.menuRoutes || !menuHides(h.route, ctx.menuRoutes));
    // Capped again here. The palette shows a handful; sending eighty rows to
    // render six is wasted bandwidth on a shop's connection.
    return NextResponse.json({ hits: hits.slice(0, 20) });
  } catch (err) {
    console.error('[search]', err);
    return NextResponse.json({ hits: [] });
  }
}
