import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { checkStaffPassword } from '@/server/auth/staff-password';
import { activeLoginBlock } from '@/server/discipline';
import { resolveLoginEligibility } from '@/server/auth/login-eligibility';
import { issueTokenPair } from '@/server/auth/mobile-tokens';
import { checkPhoneForLogin } from '@/server/device-trust';

/**
 * Staff/owner password login - the mobile-API counterpart to
 * `app/login/actions.ts`. Same credential check, same
 * `resolveLoginEligibility()` (store access + tenant-lifecycle) the web
 * login uses, so a suspended tenant is refused here exactly as it is on the
 * web - just returning a token pair instead of setting a cookie, since a
 * native app has no reliable cookie jar. See PLATFORM-API-LAYER.md §4.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.slice(0, 100) : null;

  if (!username || !password) {
    return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 });
  }

  try {
    const checked = await checkStaffPassword(username, password, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 'Vcare');
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    const user = checked.user;
    if (!user.isActive) {
      return NextResponse.json({ error: 'This account is inactive. Contact your administrator.' }, { status: 403 });
    }

    /**
     * A TEMPORARY PASSWORD DOES NOT WORK ON THE PHONE (3 Oct 2026).
     *
     * The website sends somebody with `mustChangePassword` to /set-password. The
     * app has no equivalent screen, and building one would mean shipping a new
     * APK before an admin could reset anybody's password - so instead the
     * refusal says exactly what to do, which is the one thing a technician
     * standing at a gate at 09:00 actually needs.
     *
     * Refused rather than let through: the password an admin read out has been
     * seen by two people, and letting it sign in to the app would leave it
     * working on a device indefinitely through the refresh token.
     */
    if (user.mustChangePassword) {
      return NextResponse.json(
        {
          error: 'Your administrator reset your password. Sign in on the Atlas website once to '
            + 'choose your own, then sign in here with that.',
          code: 'MUST_CHANGE_PASSWORD',
        },
        { status: 403 },
      );
    }

    const block = await activeLoginBlock(user.id);
    if (block) {
      return NextResponse.json(
        { error: `Sign-in is blocked - ${block.title} (${block.actionKind}). Contact your administrator.` },
        { status: 403 },
      );
    }

    const eligibility = await resolveLoginEligibility(user.id);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.error }, { status: 403 });
    }

    // Vcare: an employee signs in only on the phone paired to them. The
    // app sends its device token; owners are exempt (server/device-trust).
    // `code` lets the app send the person to the pairing screen.
    const phone = await checkPhoneForLogin(user.id, req.headers.get('x-device-token'));
    if (!phone.ok) {
      return NextResponse.json({ error: phone.message, code: phone.code }, { status: 403 });
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);

    const tokens = await issueTokenPair('user', user.id, deviceLabel);
    return NextResponse.json({
      ...tokens,
      role: eligibility.destination, // 'dashboard' | 'platform' - the mobile app routes UI based on this
      user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, phone: user.phone },
    });
  } catch (err) {
    console.error('[api/v1/auth/login]', err);
    return NextResponse.json({ error: 'Could not sign you in right now. Please try again.' }, { status: 500 });
  }
}
