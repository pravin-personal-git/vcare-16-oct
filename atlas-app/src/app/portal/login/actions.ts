'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/server/db';
import { createPortalSession, destroyPortalSession } from '@/server/portal-auth/session';
import { verifyPortalLogin, PortalCredentialsError, type PortalBusinessChoice } from '@/server/portal-auth/credentials';
import { portalPathFor } from '@/lib/portal-target';

export interface PortalLoginState {
  error?: string;
  /** The same number opens accounts at several businesses: pick one. */
  choices?: PortalBusinessChoice[];
  /**
   * Signing in from a business's shop with an account that belongs to a
   * DIFFERENT business (4 Oct 2026). Not signed in - see `login`.
   */
  notHere?: { businessName: string };
}

/**
 * Only somewhere inside this site, and only the customer's side of it. An open
 * redirect on a login page is how a phishing link borrows a real domain.
 */
function safeNext(raw: unknown): string {
  const next = typeof raw === 'string' ? raw : '';
  if (!/^\/(portal|shop)(\/|$)/.test(next) || next.startsWith('//') || next.includes('\\')) return '/portal';
  return next;
}

/**
 * Named `login`, not `portalLogin` - permission-coverage.test.ts exempts
 * `login`/`logout` by name specifically because signing in is "the thing you
 * do before you have any permissions" (staff or customer, the same is true
 * here). Distinct module from app/login/actions.ts, so no collision.
 *
 * ONE NUMBER, SEVERAL BUSINESSES (3 Oct 2026). The website used to take the
 * first portal account on a phone number, so a customer of two businesses on
 * one server could sign in from Vcare's shop and land in somebody else's
 * portal. It now uses the same check as Vcare: when the password opens more
 * than one account, the shop they came from decides, and failing that they pick.
 */
export async function login(_prev: PortalLoginState, formData: FormData): Promise<PortalLoginState> {
  const phone = String(formData.get('phone') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const chosen = String(formData.get('partyId') ?? '') || null;
  const shopSlug = String(formData.get('shop') ?? '').trim().toLowerCase() || null;
  let next = safeNext(formData.get('next'));

  if (!phone || !password) {
    return { error: 'Enter your phone number and password.' };
  }

  try {
    let result = await verifyPortalLogin(phone, password, chosen);

    /**
     * FROM A SHOP, ONLY THAT SHOP'S ACCOUNT (4 Oct 2026).
     *
     * Signing in from Vcare's shop with an account at another business used to
     * succeed silently, then land on Vcare's list as a visitor - "Sign in" and
     * "Create an account" still showing, with no word of why. Found on live:
     * a N.A.I.R. customer signing in from /shop/vcareglobal three times.
     *
     * Now: the account must belong to the business whose shop this is. If the
     * number only opens accounts elsewhere, nobody is signed in and the page
     * says so, offering an account here or the plain sign-in for the other.
     */
    if (shopSlug) {
      const shopOrg = await db.organization.findFirst({
        where: { shopSlug },
        select: { name: true, stores: { select: { id: true } } },
      });
      if (shopOrg) {
        const here = new Set(shopOrg.stores.map((s) => s.id));
        const ids = 'choices' in result ? result.choices.map((c) => c.partyId) : [result.party.id];
        const mine = await db.party.findMany({ where: { id: { in: ids } }, select: { id: true, storeId: true } });
        const ours = mine.filter((m) => here.has(m.storeId));
        if (ours.length === 0) return { notHere: { businessName: shopOrg.name } };
        if ('choices' in result) {
          if (ours.length === 1) result = await verifyPortalLogin(phone, password, ours[0].id);
          else return { choices: result.choices.filter((c) => ours.some((o) => o.id === c.partyId)) };
        }
      }
    }

    if ('choices' in result) return { choices: result.choices };

    // A password somebody else set must be replaced before anything else,
    // wherever they were heading.
    if (result.party.mustReset) next = '/portal/reset-password';

    const h = await headers();
    await createPortalSession(result.party.id, {
      userAgent: h.get('user-agent') ?? undefined,
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
  } catch (err) {
    if (err instanceof PortalCredentialsError) return { error: err.message };
    console.error('[portal-login] failed', err);
    return { error: 'Could not sign you in right now. Please try again.' };
  }

  // A signed-in customer works inside the portal; the shop is a tab there.
  redirect(next.startsWith('/portal/reset-password') ? next : portalPathFor(next));
}

export async function logout() {
  try {
    await destroyPortalSession();
  } catch (err) {
    console.error('[portal-logout] failed', err);
  }
  redirect('/portal/login');
}
