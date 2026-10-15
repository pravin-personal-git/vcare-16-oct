/**
 * Customer sites - the small pure rules.
 *
 * Coordinates are READ from a map link when the link carries them, and never
 * guessed: a site with a wrong pin sends a technician to the wrong building,
 * which is worse than a site with no pin at all.
 */

/**
 * Latitude and longitude out of the Google Maps link shapes people actually
 * paste: `maps?q=21.09,81.27`, `.../@21.09,81.27,17z`, `...&ll=21.09,81.27`,
 * `.../search/21.09,+81.27`. Short links (maps.app.goo.gl) carry no
 * coordinates and return null - resolving them would need a network call.
 */
export function coordsFromMapLink(link: string | null | undefined): { lat: number; lng: number } | null {
  const s = decodeURIComponent(String(link ?? '')).replace(/\+/g, ' ');
  const patterns = [
    /[?&](?:q|query|ll|destination)=\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /\/search\/\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
  ];
  for (const p of patterns) {
    const m = p.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** One way of writing a site name, for spotting "Head office" twice. */
export function normaliseSiteName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface SiteInput {
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  mapLink?: string | null;
}

/** Checks on a site before it is saved. Returns the reason, or null. */
export function validateSite(s: SiteInput, existingNames: string[] = []): string | null {
  const name = s.name.trim();
  if (!name) return 'The site needs a name - "Head office", "Godown", the branch name.';
  if (name.length > 120) return 'That site name is too long.';
  if (existingNames.map(normaliseSiteName).includes(normaliseSiteName(name))) {
    return `This customer already has a site called "${name}".`;
  }
  const phone = (s.contactPhone ?? '').replace(/\D/g, '');
  if (s.contactPhone?.trim() && (phone.length < 6 || phone.length > 13)) return 'That contact number does not look like a phone number.';
  if (s.mapLink?.trim() && !/^https?:\/\//i.test(s.mapLink.trim())) return 'A map link starts with http:// or https://.';
  return null;
}
