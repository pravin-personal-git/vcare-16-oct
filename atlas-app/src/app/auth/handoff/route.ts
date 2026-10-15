import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { resolveLoginEligibility } from '@/server/auth/login-eligibility';
import { consumeWebHandoff } from '@/server/auth/web-handoff';
import { ACTIVE_STORE_COOKIE } from '@/server/context';
import { isHandoffCodeShape, safeNextPath } from '@/lib/web-handoff';

/**
 * The landing point of a one-time link from Vcare: spend the code, open
 * an ordinary web session (the same `createSession` the login form uses,
 * after the same eligibility check), and go to the dashboard. Anything wrong
 * - bad, used or expired code, inactive account, locked organisation - goes
 * to the normal login page instead, never to an error screen that explains
 * which part failed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = NextResponse.redirect(new URL('/login', url.origin));

  const code = url.searchParams.get('code');
  if (!isHandoffCodeShape(code)) return fail;

  const ticket = await consumeWebHandoff(code).catch(() => null);
  if (!ticket) return fail;

  const user = await db.user.findUnique({ where: { id: ticket.userId }, select: { id: true, isActive: true } });
  if (!user?.isActive) return fail;
  const eligibility = await resolveLoginEligibility(user.id);
  if (!eligibility.ok) return fail;

  await createSession(user.id, {
    rememberMe: true,
    userAgent: req.headers.get('user-agent') ?? undefined,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });
  if (ticket.storeId) {
    // The branch the phone was working in becomes the web's too (saved on
    // the person - see actions/store.ts). Only one of theirs is accepted.
    const owns = await db.userStoreRole.findFirst({ where: { userId: user.id, storeId: ticket.storeId }, select: { storeId: true } });
    if (owns) await db.user.update({ where: { id: user.id }, data: { lastStoreChoice: ticket.storeId } });
    (await cookies()).set(ACTIVE_STORE_COOKIE, ticket.storeId, {
      httpOnly: true, sameSite: 'lax', path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  // A tapped phone notification asks for a page (web-link 'next'): same site only.
  const safeNext = safeNextPath(url.searchParams.get('next'));
  return NextResponse.redirect(new URL(safeNext ?? (eligibility.destination === 'dashboard' ? '/dashboard' : '/platform'), url.origin));
}
