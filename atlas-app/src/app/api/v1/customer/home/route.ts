import { customer } from '@/server/auth/v1-customer';
import { db } from '@/server/db';
import { getPortalHome, listMyComplaints } from '@/server/portal';
import { brandHexes } from '@/lib/appearance';

export async function GET(req: Request) {
  return customer(req, async (c) => {
    const [summary, complaints, store] = await Promise.all([
      getPortalHome(c.partyId, c.storeId),
      listMyComplaints(c.partyId, c.storeId),
      db.store.findUnique({ where: { id: c.storeId }, select: { name: true, organization: { select: { name: true, themeTokens: true } } } }),
    ]);
    return {
      summary,
      recentComplaints: complaints.slice(0, 5),
      business: {
        name: store?.organization.name ?? '',
        branch: store?.name ?? '',
        // The business's colours, so Vcare wears them (UI refresh phase 5).
        brand: brandHexes(store?.organization.themeTokens),
      },
    };
  });
}
