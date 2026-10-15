import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { requestOtp, OtpError } from '@/server/auth/otp';

/**
 * Staff/owner OTP login, step 1 of 2 - request a code by username, sent to
 * whichever phone/email is on file for that account. `verify/route.ts` is
 * step 2. See `server/auth/otp-delivery.ts` for why this already works end
 * to end even before a real SMS/email provider is configured.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? '').trim().toLowerCase();
  const channel = body?.channel === 'email' ? 'email' : body?.channel === 'sms' ? 'sms' : null;

  if (!username || !channel) {
    return NextResponse.json({ error: 'Enter your username and choose sms or email.' }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { username },
    select: { id: true, isActive: true, phone: true, email: true },
  });

  // Same response shape whether or not the username exists, or a
  // reachable channel is on file - do not let this route reveal that.
  const generic = { ok: true as const };

  if (!user || !user.isActive) return NextResponse.json(generic);

  const destination = channel === 'sms' ? user.phone : user.email;
  if (!destination) return NextResponse.json(generic);

  try {
    const { devCode } = await requestOtp({ channel, destination, purpose: 'staff_login', userId: user.id });
    return NextResponse.json({ ...generic, ...(devCode ? { devCode } : {}) });
  } catch (err) {
    if (err instanceof OtpError) return NextResponse.json({ error: err.message }, { status: 429 });
    console.error('[api/v1/auth/otp/request]', err);
    return NextResponse.json({ error: 'Could not send a code right now. Please try again.' }, { status: 500 });
  }
}
