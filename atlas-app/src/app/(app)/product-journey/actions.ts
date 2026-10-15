'use server';

import { requireContext } from '@/server/context';
import { findUnitForJourney, productJourney } from '@/server/product-journey';
import { findProducts, productHistory, type ProductHit } from '@/server/product-history';
import { friendlyError } from '@/lib/friendly-error';
import { serialiseProduct, serialiseUnit, type ProductHistoryVM, type UnitJourneyVM } from './serialise';

/**
 * One search box, three kinds of answer.
 *
 * Somebody at a counter is reading a label. They do not know, and should not
 * have to know, whether the number on it is a catalogue code, a barcode or a
 * serial. So one box takes all of them and this decides:
 *
 *   - exactly one product matches -> open its history
 *   - several match               -> show the list
 *   - a serial matches            -> open that PRODUCT, with the serial noted
 *
 * The last one is the one that changed. A serial used to open a unit-only
 * view, which on real data is nearly empty: no unit on record carries its sale
 * yet. Landing on the product always has something true to show, and the unit
 * itself sits in the list underneath where it belongs.
 */
export async function searchHistoryAction(query: string): Promise<{
  hits?: ProductHit[];
  product?: ProductHistoryVM;
  error?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.view')) {
      return { error: 'You do not have permission to look up stock.' };
    }

    const q = query.trim();
    if (q.length < 2) return { hits: [] };

    const hits = await findProducts(ctx.scope, q);
    if (hits.length === 1) {
      const p = await productHistory(ctx.scope, hits[0]!.id);
      if (p) return { product: serialiseProduct(p) };
    }
    return { hits };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Open one product's history by id, from the match list or a link. */
export async function openProductAction(productId: string): Promise<{
  product?: ProductHistoryVM; error?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.view')) {
      return { error: 'You do not have permission to look up stock.' };
    }
    const p = await productHistory(ctx.scope, productId);
    if (!p) return { error: 'That product is not in this branch.' };
    return { product: serialiseProduct(p) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Open one physical unit's own trail, from a row in the units list. */
export async function openUnitAction(unitId: string): Promise<{
  unit?: UnitJourneyVM; error?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.view')) {
      return { error: 'You do not have permission to look up stock.' };
    }
    const j = await productJourney(ctx.scope, unitId);
    if (!j) return { error: 'That unit is not in this branch.' };
    return { unit: serialiseUnit(j) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Kept for the scanner and any older link that passes a serial. */
export async function findUnitsAction(query: string): Promise<{
  hits: { id: string; serialNo: string | null; productName: string }[];
}> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.view')) return { hits: [] };
  return { hits: await findUnitForJourney(ctx.scope, query) };
}
