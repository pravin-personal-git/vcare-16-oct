import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { requestOtp, OtpError } from '@/server/auth/otp';

/**
 * Business-customer OTP login, step 1 of 2. Identified directly by phone or
 * email (customers have no username) - same cross-store, `portalEnabled`-only
 * lookup `verifyPortalCredentials` uses for the password path, and the same
 * "collisions blocked at enable-time" guarantee from
 * `app/(app)/customers/actions.ts` applies here too.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const channel = body?.channel === 'email' ? 'email' : body?.channel === 'sms' ? 'sms' : null;
  const identifier = String(body?.phone ?? body?.email ?? '').trim();

  if (!channel || !identifier) {
    return NextResponse.json({ error: 'Enter your phone or email and choose sms or email.' }, { status: 400 });
  }

  // Same response shape regardless of whether a matching account exists.
  const generic = { ok: true as const };

  const party = channel === 'sms'
    ? await db.party.findFirst({ where: { phone: identifier, portalEnabled: true }, select: { id: true, phone: true } })
    : await db.party.findFirst({ where: { email: identifier, portalEnabled: true }, select: { id: true, email: true } });

  if (!party) return NextResponse.json(generic);

  const destination = channel === 'sms' ? (party as { phone: string }).phone : (party as { email: string | null }).email;
  if (!destination) return NextResponse.json(generic);

  try {
    const { devCode } = await requestOtp({ channel, destination, purpose: 'customer_login', partyId: party.id });
    return NextResponse.json({ ...generic, ...(devCode ? { devCode } : {}) });
  } catch (err) {
    if (err instanceof OtpError) return NextResponse.json({ error: err.message }, { status: 429 });
    console.error('[api/v1/auth/customer-login/otp/request]', err);
    return NextResponse.json({ error: 'Could not send a code right now. Please try again.' }, { status: 500 });
  }
}
