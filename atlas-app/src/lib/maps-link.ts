/**
 * Pulling a coordinate out of a Google Maps link - pure, no network.
 *
 * A customer raising a complaint may not be standing at the site right now,
 * so "click to share your location" is not always the right tool - they
 * paste a Maps link for the place instead. Handles the URL shapes Maps
 * actually produces when you tap Share; does not handle short links
 * (maps.app.goo.gl, goo.gl/maps) here, since those only resolve via an HTTP
 * redirect a browser can't follow cross-origin - see resolveMapsLink in
 * server/maps-link-server.ts for that half.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

function inRange(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
}

/**
 * Parses the coordinate patterns Google Maps puts directly in a URL:
 *
 *   https://maps.google.com/?q=21.1908,81.2812
 *   https://www.google.com/maps?q=21.1908,81.2812
 *   https://www.google.com/maps/@21.1908,81.2812,15z
 *   https://www.google.com/maps/place/Some+Place/@21.1908,81.2812,17z/data=...
 *   https://www.google.com/maps?ll=21.1908,81.2812
 *   A bare "21.1908,81.2812" pair, in case someone just copies the numbers.
 *
 * Returns null for a short link (maps.app.goo.gl, goo.gl/maps) or anything
 * that isn't a Maps URL at all - both are the caller's cue to try the
 * server-side resolver instead.
 */
export function parseMapsLink(input: string): LatLng | null {
  const text = input.trim();
  if (!text) return null;

  // A bare "lat,lng" pair with nothing else around it.
  const bare = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(text);
  if (bare) {
    const lat = Number(bare[1]);
    const lng = Number(bare[2]);
    if (inRange(lat, lng)) return { lat, lng };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const isGoogleMaps = host === 'maps.google.com' || host === 'google.com';
  if (!isGoogleMaps) return null;

  // ?q=lat,lng or ?ll=lat,lng
  for (const param of ['q', 'll']) {
    const value = url.searchParams.get(param);
    if (!value) continue;
    const m = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(value.trim());
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inRange(lat, lng)) return { lat, lng };
    }
  }

  // /@lat,lng,zoom anywhere in the path - the pattern Maps uses once you've
  // navigated to a place, with or without a place name before it.
  const atMatch = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),/.exec(url.pathname);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (inRange(lat, lng)) return { lat, lng };
  }

  return null;
}

/** True for a link this module can only resolve server-side (a redirect). */
export function isShortMapsLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.replace(/^www\./, '');
    return host === 'maps.app.goo.gl' || host === 'goo.gl';
  } catch {
    return false;
  }
}
