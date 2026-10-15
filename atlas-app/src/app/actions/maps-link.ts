'use server';

import { resolveLocationInput } from '@/server/maps-link';

/**
 * The one thing this exists to do: resolve a pasted location input (a Maps
 * link, short or long, or a bare "lat,lng") to coordinates. No permission
 * gate - resolving a link is not a write, and both the staff and portal
 * complaint forms need this from very different auth contexts, so gating it
 * on a permission the portal session doesn't have would just break the
 * portal's copy of the same form.
 */
export async function resolveLocationInputAction(input: string) {
  return resolveLocationInput(input);
}
