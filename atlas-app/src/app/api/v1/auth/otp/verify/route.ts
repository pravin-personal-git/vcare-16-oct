import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { verifyOtp, OtpError } from '@/server/auth/otp';
import { resolveLoginEligibility } from '@/server/auth/login-eligibility';
import { issueTokenPair } from '@/server/auth/mobile-tokens';

/** Staff/owner OTP login, step 2 of 2 - same eligibility check `login/route.ts` applies. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? '').trim().toLowerCase();
  const channel = body?.channel === 'email' ? 'email' : body?.channel === 'sms' ? 'sms' : null;
  const code = String(body?.code ?? '').trim();
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.slice(0, 100) : null;

  if (!username || !channel || !code) {
    return NextResponse.json({ error: 'Missing username, channel or code.' }, { status: 400 });
  }

  try {
    const user = await db.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
    }

    const destination = channel === 'sms' ? user.phone : user.email;
    if (!destination) return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });

    const result = await verifyOtp({ destination, purpose: 'staff_login', code });
    if (result.userId !== user.id) {
      // Defensive - verifyOtp already scopes by destination+purpose, this
      // can only happen if two users somehow share a phone/email.
      return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
    }

    const eligibility = await resolveLoginEligibility(user.id);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.error }, { status: 403 });
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);

    const tokens = await issueTokenPair('user', user.id, deviceLabel);
    return NextResponse.json({
      ...tokens,
      role: eligibility.destination,
      user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, phone: user.phone },
    });
  } catch (err) {
    if (err instanceof OtpError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error('[api/v1/auth/otp/verify]', err);
    return NextResponse.json({ error: 'Could not verify that code right now. Please try again.' }, { status: 500 });
  }
}
