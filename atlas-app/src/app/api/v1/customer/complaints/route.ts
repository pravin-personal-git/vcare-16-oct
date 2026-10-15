import { customer } from '@/server/auth/v1-customer';
import { V1Error, str } from '@/server/auth/v1-staff';
import { createPortalComplaint, listMyComplaints, listMyPurchasedProducts } from '@/server/portal';
import { resolveLocationInput } from '@/server/maps-link';

/** The customer's complaints, and what they bought (to raise one against). */
export async function GET(req: Request) {
  return customer(req, async (c) => ({
    complaints: await listMyComplaints(c.partyId, c.storeId),
    products: await listMyPurchasedProducts(c.partyId, c.storeId),
  }));
}

/**
 * Raise a complaint or ask for a service visit. The site must be located -
 * the phone's GPS, or a pasted Google Maps link resolved on the server - as
 * on the website's portal.
 */
export async function POST(req: Request) {
  return customer(req, async (c) => {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const description = str(b.description, 4000);
    if (!description) throw new V1Error('Tell us what the problem is.');
    let lat: number | null = Number(b.lat), lng: number | null = Number(b.lng);
    let source: 'gps' | 'maps_link' | null = 'gps';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const link = str(b.mapsLink, 1000);
      const resolved = link ? await resolveLocationInput(link) : null;
      if (resolved) {
        lat = resolved.lat; lng = resolved.lng; source = 'maps_link';
      } else {
        // No pin sent. Whether that is allowed is the branch's Field rule, and
        // createComplaint is the one place that decides it. Refusing here as
        // well would mean the phone app ignored a setting the web form obeys.
        lat = null; lng = null; source = null;
      }
    }
    const kind = b.kind === 'visit' ? 'Service visit request' : null;
    const id = await createPortalComplaint(c.partyId, c.storeId, {
      productId: str(b.productId, 60),
      siteLocation: str(b.siteNote, 300),
      siteLat: lat, siteLng: lng, siteSource: source,
      description: kind ? `${kind}: ${description}` : description,
      customFields: {},
    });
    return { ok: true, id };
  });
}
