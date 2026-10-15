import { customer } from '@/server/auth/v1-customer';
import { V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { hashPassword, verifyPassword } from '@/server/auth/password';

const MIN_LENGTH = 8;

/**
 * Change the customer's password. The current one is required unless the
 * business issued a temporary password that must be replaced on first sign-in.
 */
export async function POST(req: Request) {
  return customer(req, async (c) => {
    const b = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
    const next = String(b.next ?? '');
    if (next.length < MIN_LENGTH) throw new V1Error(`Password must be at least ${MIN_LENGTH} characters.`);
    const party = await db.party.findUnique({ where: { id: c.partyId }, select: { portalPasswordHash: true, portalMustReset: true } });
    if (!party) throw new V1Error('Please sign in again.', 401);
    if (!party.portalMustReset) {
      const ok = party.portalPasswordHash ? await verifyPassword(String(b.current ?? ''), party.portalPasswordHash) : false;
      if (!ok) throw new V1Error('Your current password is not right.');
    }
    await db.party.update({ where: { id: c.partyId }, data: { portalPasswordHash: await hashPassword(next), portalMustReset: false } });
    return { ok: true };
  });
}
