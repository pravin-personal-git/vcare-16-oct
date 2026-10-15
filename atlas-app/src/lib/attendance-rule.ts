import { metresBetween, isUsableFix, type Fix } from './shift';

/**
 * Where an employee may clock in - Vcare roadmap §7, decided 24 Sep 2026:
 * set by the admin per employee, with a store-wide default.
 *
 *   store_default   the store's own geofence setting (on or off), flag only
 *   anywhere        no place check
 *   zones           the store's office zones (all, or the ones chosen)
 *   zones_or_sites  zones, or the site of a customer job assigned to them
 *
 * Outside the allowed places: 'flag' records the clock-in and marks it,
 * 'block' refuses it with a sentence the employee can act on.
 */

export const ALLOW_MODES = ['store_default', 'anywhere', 'zones', 'zones_or_sites'] as const;
export type AllowMode = (typeof ALLOW_MODES)[number];
export const OUTSIDE_MODES = ['flag', 'block'] as const;
export type OutsideMode = (typeof OUTSIDE_MODES)[number];

export const ALLOW_LABEL: Record<AllowMode, string> = {
  store_default: 'Store setting',
  anywhere: 'Anywhere',
  zones: 'Office zones only',
  zones_or_sites: 'Office zones or job sites',
};
export const OUTSIDE_LABEL: Record<OutsideMode, string> = {
  flag: 'Allow and flag',
  block: 'Block',
};

export interface Place {
  id: string;
  kind: 'zone' | 'site';
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface RuleInput {
  allow: AllowMode;
  outside: OutsideMode;
  /** The store's own "geofencing enabled" switch - used by store_default. */
  storeGeofencing: boolean;
  zones: Place[];
  sites: Place[];
  fix: Fix | null;
}

export interface RuleResult {
  /** null = not checked (no rule applies). */
  withinPolicy: boolean | null;
  matchedZoneId: string | null;
  matchedSiteId: string | null;
  distanceMeters: number | null;
  blocked: boolean;
  /** For the employee, when outside: the nearest allowed place and how far. */
  message: string | null;
}

function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function evaluateClockIn(r: RuleInput): RuleResult {
  const notChecked: RuleResult = { withinPolicy: null, matchedZoneId: null, matchedSiteId: null, distanceMeters: null, blocked: false, message: null };

  if (r.allow === 'anywhere') return notChecked;
  if (r.allow === 'store_default' && !r.storeGeofencing) return notChecked;

  const places = r.allow === 'zones_or_sites' ? [...r.zones, ...r.sites] : r.zones;
  if (places.length === 0) return notChecked; // nothing to check against - never block on an empty list
  const outside = r.allow === 'store_default' ? 'flag' : r.outside;

  if (!r.fix || !isUsableFix(r.fix)) {
    return {
      ...notChecked, withinPolicy: false, blocked: outside === 'block',
      message: 'Your location could not be read. Turn on location and try again outdoors.',
    };
  }

  let best: { place: Place; d: number } | null = null;
  let nearest: { place: Place; d: number } | null = null;
  for (const place of places) {
    const d = metresBetween(r.fix, place);
    if (!nearest || d < nearest.d) nearest = { place, d };
    if (d <= place.radiusMeters && (!best || d < best.d)) best = { place, d };
  }

  if (best) {
    return {
      withinPolicy: true,
      matchedZoneId: best.place.kind === 'zone' ? best.place.id : null,
      matchedSiteId: best.place.kind === 'site' ? best.place.id : null,
      distanceMeters: Math.round(best.d),
      blocked: false,
      message: null,
    };
  }
  return {
    ...notChecked,
    withinPolicy: false,
    blocked: outside === 'block',
    message: nearest ? `You are ${km(nearest.d)} from ${nearest.place.name}.` : null,
  };
}

/**
 * A time the phone says something happened. Offline clock-ins keep the
 * phone's time - but never one in the future, nor more than a day old: those
 * are a wrong clock or tampering, and the server's own time is used instead.
 */
export function acceptedEventTime(clientMs: number | null | undefined, now: Date = new Date()): { at: Date; trusted: boolean } {
  if (typeof clientMs !== 'number' || !Number.isFinite(clientMs)) return { at: now, trusted: false };
  const delta = now.getTime() - clientMs;
  if (delta < -5 * 60_000 || delta > 24 * 60 * 60_000) return { at: now, trusted: false };
  return { at: new Date(Math.min(clientMs, now.getTime())), trusted: true };
}

/**
 * Points to keep from a batch of tracking fixes: every point that moved at
 * least `minMoveM` or came `minGapMs` after the last kept one - the phone
 * already spaces them (2 min moving, 10 min still), this only drops jitter.
 */
export function thinTrack<T extends Fix & { at: number }>(points: T[], last: (Fix & { at: number }) | null, minMoveM = 20, minGapMs = 90_000): T[] {
  const sorted = [...points].filter((p) => isUsableFix(p)).sort((a, b) => a.at - b.at);
  const kept: T[] = [];
  let prev = last;
  for (const p of sorted) {
    if (prev && metresBetween(prev, p) < minMoveM && p.at - prev.at < minGapMs) continue;
    kept.push(p);
    prev = p;
  }
  return kept;
}
