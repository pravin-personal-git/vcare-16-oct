import { metresBetween, type Fix } from './shift';

/**
 * Geofence matching - pure functions, no database.
 *
 * Reuses `metresBetween` (haversine) from lib/shift.ts rather than a second
 * distance formula. This file adds the one thing that didn't exist yet: a
 * threshold/membership check - "is this point within N metres of that one" -
 * used identically for an employee's attendance zone and a technician's
 * field check-in against a complaint's coordinates. One primitive, two
 * callers, so a bug fixed here is fixed everywhere it matters.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Whether `point` falls within `radiusMeters` of `center`. */
export function isWithinRadius(point: Fix, center: GeoPoint, radiusMeters: number): boolean {
  return metresBetween(point, center) <= radiusMeters;
}

export interface ZoneCandidate {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface ZoneMatch {
  zoneId: string;
  distanceMeters: number;
}

/**
 * The closest zone a point falls inside, or null if it is outside all of
 * them. Several zones can overlap; the nearest one is the more useful answer
 * to show someone ("you matched Warehouse 2, 40m away") than an arbitrary
 * first match.
 */
export function nearestZoneMatch(point: Fix, zones: ZoneCandidate[]): ZoneMatch | null {
  let best: ZoneMatch | null = null;
  for (const zone of zones) {
    const distanceMeters = metresBetween(point, { lat: zone.lat, lng: zone.lng });
    if (distanceMeters > zone.radiusMeters) continue;
    if (!best || distanceMeters < best.distanceMeters) {
      best = { zoneId: zone.id, distanceMeters };
    }
  }
  return best;
}

/**
 * IP restriction - exact match or a simple CIDR check, IPv4 only (every
 * deployment target for this is an office/warehouse network, not IPv6).
 *
 * `ranges` is a comma-separated list of exact IPs and/or CIDR blocks, as
 * stored on `AttendancePolicy.allowedIpRanges`.
 */
export function ipAllowed(ip: string | null, ranges: string | null): boolean {
  if (!ranges || !ranges.trim()) return false;
  if (!ip) return false;

  const list = ranges.split(',').map((r) => r.trim()).filter(Boolean);
  return list.some((r) => (r.includes('/') ? ipInCidr(ip, r) : ip === r));
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}
