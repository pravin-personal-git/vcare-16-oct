/**
 * HOW CLOSELY A PRODUCT'S STOCK IS TRACKED - the vocabulary and the rules.
 *
 * One enum drives the whole of Phase 3, and it is a property of the PRODUCT,
 * not of the tenant. A CCTV installer, a pharmacy and a consultancy are the
 * same framework with different settings, and one store mixes all four modes
 * freely - labour (`none`), cable (`quantity`), tablets (`batch`) and cameras
 * (`serial`) on the same invoice.
 *
 * In lib/ rather than server/ because the bulk tracking screen needs the
 * labels and the change rules in the browser, and server/*.ts is server-only.
 * `server-only-boundary.test.ts` enforces that split.
 *
 * Pure: no Prisma, so the rules are tested as rules.
 */

export const TRACKING_MODES = ['none', 'quantity', 'batch', 'serial'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const TRACKING_MODE_LABEL: Record<TrackingMode, string> = {
  none: 'Not stocked',
  quantity: 'By quantity',
  batch: 'By batch / lot',
  serial: 'By serial number',
};

/** One line each, shown beside the choice so nobody has to guess. */
export const TRACKING_MODE_HINT: Record<TrackingMode, string> = {
  none: 'Labour, charges, fees. Never touches stock.',
  quantity: 'Cable, connectors, fixings. A count on the shelf.',
  batch: 'Anything with an expiry or a per-lot cost. Each delivery is a lot.',
  serial: 'Cameras, recorders, switches. One record per physical unit.',
};

export function isTrackingMode(v: unknown): v is TrackingMode {
  return typeof v === 'string' && (TRACKING_MODES as readonly string[]).includes(v);
}

/** Whether a product in this mode has stock at all. */
export function movesStock(mode: string): boolean {
  return mode !== 'none';
}

export type ProductKind = 'goods' | 'service';

/**
 * The one rule tying `kind` to `trackingMode`: a service is never stocked.
 *
 * One-directional on purpose. A service must be `none`, because a unit of
 * labour cannot sit on a shelf. Goods MAY be `none` - a drop-shipped item that
 * never passes through the building is still goods, with an HSN, and still not
 * our stock.
 */
export function modeAllowedFor(kind: string, mode: string): boolean {
  if (!isTrackingMode(mode)) return false;
  if (kind === 'service') return mode === 'none';
  return true;
}

/** What the screen and the server both need to know about a product to change it. */
export interface TrackingSubject {
  productName: string;
  kind: string;
  trackingMode: string;
  /** Current `ProductBalance.currentQty`, summed across warehouses. */
  onHand: number;
  /** Units of this product currently on the shelf (in stock or reserved). */
  unitsOnShelf: number;
}

export type ChangePlan =
  | { ok: true; kind: ProductKind; trackingMode: TrackingMode; warning: string | null }
  | { ok: false; reason: string };

/**
 * Change how a product is tracked.
 *
 * REFUSED:
 *  - an unknown mode
 *  - tracking a service - mark it as goods first. Not done silently, because
 *    it also switches the line from a SAC to an HSN, which is a GST decision
 *    somebody should make on purpose.
 *  - `none` while stock is on hand. A product that "is not stocked" and has 12
 *    on the shelf is a contradiction the ledger would then hide; count it to
 *    zero first, and the count leaves a movement explaining where they went.
 *
 * ALLOWED WITH A WARNING:
 *  - to `serial` with stock on hand but fewer units than that. Legitimate -
 *    it is exactly the state after a "count only" receipt - but somebody should
 *    know the units are still to be recorded.
 */
export function planModeChange(p: TrackingSubject, to: string): ChangePlan {
  if (!isTrackingMode(to)) return { ok: false, reason: `"${to}" is not a tracking mode.` };

  if (p.kind === 'service' && to !== 'none') {
    return {
      ok: false,
      reason: `${p.productName} is a service. Mark it as goods first - that also moves it from a SAC to an HSN code.`,
    };
  }

  if (to === 'none' && p.onHand !== 0) {
    return {
      ok: false,
      reason: `${p.productName} has ${p.onHand} on hand. Count it to zero first, so the ledger records where they went.`,
    };
  }

  let warning: string | null = null;
  if (to === 'serial' && p.onHand > p.unitsOnShelf) {
    const missing = p.onHand - p.unitsOnShelf;
    warning = `${p.productName}: ${p.onHand} on hand but ${p.unitsOnShelf} with a unit record. `
      + `${missing} still need serials - receive them as placeholders or record them in opening stock.`;
  }

  return { ok: true, kind: p.kind === 'service' ? 'service' : 'goods', trackingMode: to, warning };
}

/**
 * Change what a product IS - goods or service.
 *
 * To service: forces `none`, and is refused with stock on hand for the same
 * reason as `planModeChange`. To goods: a product that was `none` becomes
 * `quantity`, the plain default; anything already tracked keeps its mode.
 */
export function planKindChange(p: TrackingSubject, to: string): ChangePlan {
  if (to !== 'goods' && to !== 'service') {
    return { ok: false, reason: `"${to}" is neither goods nor a service.` };
  }

  if (to === 'service') {
    if (p.onHand !== 0) {
      return {
        ok: false,
        reason: `${p.productName} has ${p.onHand} on hand, and a service cannot hold stock. Count it to zero first.`,
      };
    }
    return { ok: true, kind: 'service', trackingMode: 'none', warning: null };
  }

  const mode: TrackingMode = p.trackingMode === 'none' || !isTrackingMode(p.trackingMode)
    ? 'quantity'
    : p.trackingMode;
  return { ok: true, kind: 'goods', trackingMode: mode, warning: null };
}
