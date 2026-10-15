import type { ProductHistory } from '@/server/product-history';
import type { ProductJourney } from '@/server/product-journey';

/**
 * Dates cross to the client as strings.
 *
 * In its own module rather than beside the actions, because a `'use server'`
 * file may only export async functions - a sync helper in there is a build
 * error, and a pointlessly async one is worse.
 */

const iso = (d: Date) => d.toISOString();

export type ProductHistoryVM = ReturnType<typeof serialiseProduct>;
export type UnitJourneyVM = ReturnType<typeof serialiseUnit>;

export function serialiseProduct(p: ProductHistory) {
  return {
    ...p,
    purchases: p.purchases.map((r) => ({ ...r, at: iso(r.at) })),
    sales: p.sales.map((r) => ({ ...r, at: iso(r.at) })),
    moves: p.moves.map((r) => ({ ...r, at: iso(r.at) })),
    units: p.units.map((r) => ({ ...r, receivedAt: iso(r.receivedAt) })),
    lots: p.lots.map((r) => ({
      ...r,
      receivedAt: iso(r.receivedAt),
      mfgDate: r.mfgDate ? iso(r.mfgDate) : null,
      expiryDate: r.expiryDate ? iso(r.expiryDate) : null,
    })),
  };
}

export function serialiseUnit(j: ProductJourney) {
  return { ...j, stages: j.stages.map((s) => ({ ...s, at: s.at ? iso(s.at) : null })) };
}
