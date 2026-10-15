import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { issueToVan, vanMovables } from '@/server/van-stock';

/**
 * "Load my van" from the phone (4 Oct 2026).
 *
 * The technician scans what they take at the store counter and it moves from
 * the branch shelf onto THEIR van - never anybody else's: the van is found from
 * who is signed in, not from anything the phone sends. Same checks as the
 * website (server/van-stock `checkMoveLines`): no more than the branch holds,
 * serial products by number.
 *
 * Gated like fitting from the van: `stock.adjust`, and the owner's Van section
 * for this person in Settings > Roles > Phone app.
 */
async function myVanId(scope: Parameters<typeof vanMovables>[0], userId: string) {
  const van = await db.warehouse.findFirst({
    where: { ...scopeWhere(scope), kind: 'van', holderId: userId, isActive: true },
    select: { id: true },
  });
  if (!van) throw new V1Error('You do not have a van. Ask the branch to set one up for you.', 404);
  return van.id;
}

/** `?q=` typed search, or `?code=` a scanned barcode or serial, at the branch. */
export async function GET(req: Request) {
  return field(req, ['stock.adjust'], 'van', async (ctx) => {
    const sp = new URL(req.url).searchParams;
    const vanId = await myVanId(ctx.scope, ctx.user.id);
    return vanMovables(ctx.scope, { vanId, from: 'branch', q: sp.get('q'), code: sp.get('code') });
  });
}

export async function POST(req: Request) {
  return field(req, ['stock.adjust'], 'van', async (ctx) => {
    const b = await jsonBody(req);
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const lines = raw
      .map((l: Record<string, unknown>) => ({
        productId: String(l.productId ?? ''),
        qty: Number(l.qty ?? 0),
        stockUnitIds: Array.isArray(l.stockUnitIds) ? l.stockUnitIds.map(String) : undefined,
      }))
      .filter((l: { productId: string; qty: number }) => l.productId && Number.isInteger(l.qty) && l.qty > 0);
    if (lines.length === 0) throw new V1Error('Nothing to load.', 400);

    const vanId = await myVanId(ctx.scope, ctx.user.id);
    try {
      const r = await issueToVan(ctx.scope, { vanId, lines, note: str(b.note, 500) }, ctx.user.id);
      return { ok: true, vanName: r.vanName, lines: r.lines };
    } catch (e) {
      // The checks speak in plain words ("The branch only has 3 of ...").
      throw new V1Error(e instanceof Error ? e.message : 'Could not load the van.', 400);
    }
  });
}
