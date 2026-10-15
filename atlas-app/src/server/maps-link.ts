import 'server-only';
import { parseMapsLink, isShortMapsLink, type LatLng } from '@/lib/maps-link';

/**
 * Resolving a pasted location input to coordinates.
 *
 * Direct Maps URLs (and a bare lat,lng pair) parse with no network call -
 * see lib/maps-link.ts. A short link (maps.app.goo.gl, goo.gl/maps) only
 * reveals its coordinates after Google's redirect, which a browser cannot
 * follow across origins from client-side JS - this is why the short-link
 * case needs a server action at all, rather than doing everything in the
 * browser.
 */
export async function resolveLocationInput(input: string): Promise<LatLng | null> {
  const direct = parseMapsLink(input);
  if (direct) return direct;

  if (!isShortMapsLink(input)) return null;

  try {
    // `redirect: 'follow'` (fetch's default) - Node's fetch exposes the
    // final URL as `response.url` after following every hop, which is all
    // this needs; no reason to walk the chain by hand with 'manual'.
    const res = await fetch(input.trim(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    return parseMapsLink(res.url);
  } catch (err) {
    console.error('[maps-link] could not resolve short link', err);
    return null;
  }
}
