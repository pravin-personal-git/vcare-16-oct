import { metresBetween } from './shift';

/**
 * Where an approved location override leaves the job's site (16 Oct 2026,
 * Pravin for Vcare).
 *
 * A job raised without a location cannot pass the on-site check, so the
 * technician asks for an override from the spot. Once it is approved, the
 * place he is standing becomes the job's site - so the next job there checks
 * in without a manager. One place is never saved twice: a site the customer
 * already has within SITE_MATCH_RADIUS_M is reused, and a site with a name
 * but no location gets this one.
 *
 * Decided by Pravin: 25 m (a phone's GPS drifts 10-20 m, so 10 m would save
 * the same godown two or three times), and a reading worse than
 * SITE_MAX_ACCURACY_M saves nothing - the override still counts.
 */
export const SITE_MATCH_RADIUS_M = 25;
export const SITE_MAX_ACCURACY_M = 50;

export interface PlanInput {
  /** The job already has a location of its own. */
  jobHasLocation: boolean;
  /** The site the job names, if any. */
  jobSite: { id: string; lat: number | null; lng: number | null } | null;
  /** Where the technician was when he asked. */
  reading: { lat: number; lng: number; accuracyM: number | null } | null;
  /** The customer's other sites (active, in this branch). */
  customerSites: { id: string; lat: number | null; lng: number | null }[];
}

export type OverrideSitePlan =
  | { kind: 'none'; reason: 'job_has_location' | 'no_reading' | 'poor_accuracy' }
  /** The job's own site had no location - this reading becomes it. */
  | { kind: 'fill_site'; siteId: string }
  /** A saved site is the place - the job takes its location. */
  | { kind: 'reuse_site'; siteId: string; lat: number; lng: number; distanceM: number }
  /** Nowhere saved within the radius - a new site at the reading. */
  | { kind: 'new_site' };

export function planOverrideSite(p: PlanInput): OverrideSitePlan {
  if (p.jobHasLocation) return { kind: 'none', reason: 'job_has_location' };
  if (!p.reading) return { kind: 'none', reason: 'no_reading' };
  if (p.reading.accuracyM !== null && p.reading.accuracyM > SITE_MAX_ACCURACY_M) return { kind: 'none', reason: 'poor_accuracy' };

  const here = { lat: p.reading.lat, lng: p.reading.lng };
  if (p.jobSite) {
    if (p.jobSite.lat === null || p.jobSite.lng === null) return { kind: 'fill_site', siteId: p.jobSite.id };
    // The job names a site that has a location the job never copied: that site is the place.
    const s = { lat: p.jobSite.lat, lng: p.jobSite.lng };
    return { kind: 'reuse_site', siteId: p.jobSite.id, ...s, distanceM: metresBetween(here, s) };
  }

  let best: { id: string; lat: number; lng: number; distanceM: number } | null = null;
  for (const s of p.customerSites) {
    if (s.lat === null || s.lng === null) continue;
    const d = metresBetween(here, { lat: s.lat, lng: s.lng });
    if (d <= SITE_MATCH_RADIUS_M && (!best || d < best.distanceM)) best = { id: s.id, lat: s.lat, lng: s.lng, distanceM: d };
  }
  if (best) return { kind: 'reuse_site', siteId: best.id, lat: best.lat, lng: best.lng, distanceM: best.distanceM };
  return { kind: 'new_site' };
}

/** "Site - 16 Oct (Mayank Thakur)": a name the office can change later. */
export function newSiteName(at: Date, requesterName: string | null): string {
  const day = at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  return `Site - ${day}${requesterName ? ` (${requesterName})` : ''}`;
}
