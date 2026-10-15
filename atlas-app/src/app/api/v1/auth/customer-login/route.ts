import { NextResponse } from 'next/server';
import { verifyPortalLogin, PortalCredentialsError } from '@/server/portal-auth/credentials';
import { issueTokenPair } from '@/server/auth/mobile-tokens';

/**
 * Business-customer password login - the mobile-API counterpart to
 * `app/portal/login/actions.ts`, same credential/lockout check
 * (`verifyPortalCredentials`), just returning a token pair instead of a
 * cookie. See PLATFORM-API-LAYER.md §5.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const phone = String(body?.phone ?? '').trim();
  const password = String(body?.password ?? '');
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.slice(0, 100) : null;

  if (!phone || !password) {
    return NextResponse.json({ error: 'Enter your phone number and password.' }, { status: 400 });
  }

  try {
    const partyId = typeof body?.partyId === 'string' ? body.partyId : null;
    const r = await verifyPortalLogin(phone, password, partyId);
    // One number, several businesses: the phone shows a picker and signs in again with partyId.
    if ('choices' in r) return NextResponse.json({ chooseBusiness: r.choices });
    const party = r.party;
    const tokens = await issueTokenPair('party', party.id, deviceLabel);
    return NextResponse.json({
      ...tokens,
      mustReset: party.mustReset,
      party: {
        id: party.id, firstName: party.firstName, lastName: party.lastName,
        companyName: party.companyName, phone: party.phone, email: party.email,
      },
    });
  } catch (err) {
    if (err instanceof PortalCredentialsError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error('[api/v1/auth/customer-login]', err);
    return NextResponse.json({ error: 'Could not sign you in right now. Please try again.' }, { status: 500 });
  }
}
