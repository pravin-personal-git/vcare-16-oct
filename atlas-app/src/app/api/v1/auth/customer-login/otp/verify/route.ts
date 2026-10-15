import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { verifyOtp, OtpError } from '@/server/auth/otp';
import { issueTokenPair } from '@/server/auth/mobile-tokens';

/** Business-customer OTP login, step 2 of 2. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const channel = body?.channel === 'email' ? 'email' : body?.channel === 'sms' ? 'sms' : null;
  const identifier = String(body?.phone ?? body?.email ?? '').trim();
  const code = String(body?.code ?? '').trim();
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.slice(0, 100) : null;

  if (!channel || !identifier || !code) {
    return NextResponse.json({ error: 'Missing phone/email, channel or code.' }, { status: 400 });
  }

  try {
    const party = channel === 'sms'
      ? await db.party.findFirst({ where: { phone: identifier, portalEnabled: true } })
      : await db.party.findFirst({ where: { email: identifier, portalEnabled: true } });
    if (!party) return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });

    const result = await verifyOtp({ destination: identifier, purpose: 'customer_login', code });
    if (result.partyId !== party.id) {
      return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
    }

    const tokens = await issueTokenPair('party', party.id, deviceLabel);
    return NextResponse.json({
      ...tokens,
      party: {
        id: party.id, firstName: party.firstName, lastName: party.lastName,
        companyName: party.companyName, phone: party.phone, email: party.email,
      },
    });
  } catch (err) {
    if (err instanceof OtpError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error('[api/v1/auth/customer-login/otp/verify]', err);
    return NextResponse.json({ error: 'Could not verify that code right now. Please try again.' }, { status: 500 });
  }
}
