'use server';

import { headers } from 'next/headers';
import { getShopContext, ensureSessionKey, portalInstead } from '@/server/shop-context';
import { registerShopVisitor } from '@/server/shop-register';
import { createPortalSession } from '@/server/portal-auth/session';

export interface RegisterState { error?: string; ok?: boolean; /** Where to go next, signed in. */ next?: string }

/**
 * Public, and the only public action that creates anything lasting.
 *
 * The business comes from the shop's short name, resolved again here - never
 * from anything the browser says - so an account is always made in the
 * business whose shop the visitor was standing in.
 *
 * It signs them in (changed 4 Oct 2026). The login page's rate limiting and
 * lockout protect EXISTING accounts from guessed passwords; this only ever
 * creates a NEW account - `registerShopVisitor` refuses a number the business
 * already holds - with the password typed a moment ago, so there is nothing to
 * guess. Sending them to type it again was one more screen between a new
 * customer and the list they came to send.
 */
export async function registerAction(slug: string, back: string, input: {
  name: string; phone: string; email: string;
  addressLine1: string; city: string; state: string; password: string;
}): Promise<RegisterState> {
  try {
    const shop = await getShopContext({ slug });
    if (!shop) return { error: 'This shop is not open.' };
    const sessionKey = await ensureSessionKey();
    const r = await registerShopVisitor(shop.store.id, input, sessionKey);
    /**
     * Signed in at once (4 Oct 2026). It used to say "account created, now
     * sign in" - the same number and password typed twice in a minute. The
     * same browser key goes with them, so the list they made is waiting in
     * the portal's shop.
     */
    const h = await headers();
    await createPortalSession(r.partyId, {
      userAgent: h.get('user-agent') ?? undefined,
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
    const inside = await portalInstead({ ...shop, partyId: r.partyId }, back.startsWith('/shop/') ? back : shop.base);
    return { ok: true, next: inside ?? back };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the account.' };
  }
}
