'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { db } from '@/server/db';
import { checkStaffPassword, logSignOut } from '@/server/auth/staff-password';
import { getContext } from '@/server/context';
import { createSession, destroySession } from '@/server/auth/session';
import { clearElevation } from '@/server/auth/elevation';
import { activeLoginBlock } from '@/server/discipline';
import { resolveLoginEligibility } from '@/server/auth/login-eligibility';
import { requestOtp, verifyOtp, OtpError } from '@/server/auth/otp';

export interface LoginState {
  error?: string;
  /** Platform sign-in, step two: a code went to this (masked) address. */
  otpSentTo?: string;
  /** Outside production only - the code, so the flow is testable with no email. */
  devCode?: string;
}

/**
 * The platform team's second step (6 Oct 2026): after the password, a 6-digit
 * code to the member's email. One account here can suspend any business, so a
 * stolen password alone must not be enough.
 *
 * On whenever email can be sent (RESEND_API_KEY) and everywhere outside
 * production; `PLATFORM_LOGIN_OTP=off` in Vercel switches it off if email
 * ever breaks and the team would otherwise be locked out.
 */
function platformOtpOn(): boolean {
  if (process.env.PLATFORM_LOGIN_OTP === 'off') return false;
  return process.env.NODE_ENV !== 'production' || !!process.env.RESEND_API_KEY;
}

const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_m, a: string, mid: string, b: string) => a + '*'.repeat(Math.min(mid.length, 6)) + b);

/**
 * Audit logging must never be able to block a login - and, since D046, never
 * even be on the critical path: it now runs via `after()` once the redirect
 * response is already on the wire, using the storeId the caller already
 * fetched instead of re-querying `userStoreRole` a second time.
 *
 * This was previously written as `db.activityLog.create({ data: { storeId:
 * (await findFirstOrThrow()).storeId } }).catch(...)` - the inner await runs
 * while the argument object is being built, so it executes *before* .create()
 * returns a promise and the .catch() never guarded it. A user with no store
 * assignment, or any transient database error, took the whole sign-in down
 * with a server exception.
 */
function recordLogin(userId: string, fullName: string, storeId: string | null): void {
  if (!storeId) return;
  db.activityLog
    .create({
      data: {
        storeId,
        userId,
        activityType: 'Login',
        entityType: 'User',
        entityId: userId,
        description: `${fullName} signed in`,
      },
    })
    .catch((err) => console.error('[login] audit write failed (non-fatal)', err));
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Lowercased to match storage: `administration.ts::createUser` always
  // lowercases on save, so a username typed in any other case must be
  // normalised the same way here or it silently never matches. Found and
  // fixed 17 Sep 2026 - this was a real, reproducible login bug for any
  // username containing an uppercase letter.
  const username = String(formData.get('username') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const rememberMe = formData.get('rememberMe') === 'on';

  if (!username || !password) {
    return { error: 'Enter your username and password.' };
  }

  // Set inside the try below, read by the redirect() after it - declared
  // out here because redirect() must sit outside the try (see the comment
  // by it) and therefore cannot see a `const` scoped inside.
  let destination = '/dashboard';

  try {
    const h0 = await headers();
    const checked = await checkStaffPassword(username, password, h0.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 'web');
    if (!checked.ok) return { error: checked.error };
    const user = checked.user;
    if (!user.isActive) {
      return { error: 'This account is inactive. Contact your administrator.' };
    }

    const block = await activeLoginBlock(user.id);
    if (block) {
      return { error: `Sign-in is blocked - ${block.title} (${block.actionKind}). Contact your administrator.` };
    }

    // A user with no store role AND no platform/reseller membership has
    // nothing to see and would break the shell; a suspended tenant's login
    // is refused outright (D051/D052/D055) - all resolved by the one shared
    // function `/api/v1/auth/login` (mobile) also calls, so both surfaces
    // enforce the exact same rule.
    const eligibility = await resolveLoginEligibility(user.id);
    if (!eligibility.ok) {
      return { error: eligibility.error };
    }

    destination = eligibility.destination === 'dashboard' ? '/dashboard' : '/platform';

    // Two doors since 5 Oct 2026: the business sign-in (/login) and the
    // platform team's own (/platform-login). Each turns away the other's
    // accounts, so neither page can be mistaken for the other.
    const surface = formData.get('surface') === 'platform' ? 'platform' : 'business';
    if (surface === 'business' && eligibility.destination === 'platform') {
      return { error: 'This is the business sign-in. The platform team signs in at /platform-login.' };
    }
    if (surface === 'platform') {
      const member = await db.membership.findFirst({ where: { userId: user.id }, select: { id: true } });
      if (!member) return { error: 'This sign-in is only for the platform team. Use your business sign-in page.' };
      destination = '/platform';

      if (platformOtpOn()) {
        const email = user.email?.trim().toLowerCase();
        if (!email) return { error: 'Your account has no email address for the sign-in code. Ask N.A.I.R. to add one.' };
        const code = String(formData.get('otp') ?? '').replace(/\D/g, '');
        if (!code) {
          try {
            const sent = await requestOtp({ channel: 'email', destination: email, purpose: 'platform_login', userId: user.id });
            return { otpSentTo: maskEmail(email), devCode: sent.devCode };
          } catch (e) {
            // Asked again within the minute: the first code is still good.
            if (e instanceof OtpError && /wait a moment/i.test(e.message)) return { otpSentTo: maskEmail(email) };
            if (e instanceof OtpError) return { error: e.message };
            throw e;
          }
        }
        try {
          const ok = await verifyOtp({ destination: email, purpose: 'platform_login', code });
          if (ok.userId && ok.userId !== user.id) return { error: 'Incorrect code.', otpSentTo: maskEmail(email) };
        } catch (e) {
          if (e instanceof OtpError) return { error: e.message, otpSentTo: maskEmail(email) };
          throw e;
        }
      }
    }

    const h = await headers();
    await createSession(user.id, {
      rememberMe,
      userAgent: h.get('user-agent') ?? undefined,
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });

    // Neither of these gates the redirect - both run in `after()`, once the
    // response is already on the wire, instead of adding two more sequential
    // round trips to the connection_limit=1 pool before the user gets in.
    // Found live 21 Sep 2026: a freshly-created tenant's very first login was
    // taking 5+ seconds end to end on this path alone, reading as "nothing is
    // happening" - avoiding a second `userStoreRole` re-query here (reusing
    // `eligibility.storeId` instead) is part of that fix.
    const storeId = eligibility.storeId;
    after(async () => {
      await db.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch((e) => console.error('[login] lastLoginAt update failed (non-fatal)', e));
      recordLogin(user.id, user.fullName, storeId);
    });
  } catch (err) {
    console.error('[login] failed', err);
    return { error: 'Could not sign you in right now. Please try again.' };
  }

  // Must sit outside the try - redirect() signals by throwing, and a catch
  // block would swallow it and silently do nothing.
  redirect(destination);
}

export async function logout() {
  try {
    const ctx = await getContext().catch(() => null);
    if (ctx) {
      const h = await headers();
      await logSignOut({ id: ctx.user.id, fullName: ctx.user.fullName }, h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 'web');
    }
    await destroySession();
    await clearElevation();
  } catch (err) {
    console.error('[logout] failed', err);
  }
  redirect('/login');
}
