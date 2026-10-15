import { NextResponse } from 'next/server';
import { mobileContext } from '@/server/auth/mobile-context';
import { createWebHandoff } from '@/server/auth/web-handoff';
import { safeNextPath } from '@/lib/web-handoff';

/**
 * Vcare asks for a link that opens the website already signed in.
 * Only a staff token with store access gets one; the link carries the store
 * the phone is working in, so the website opens on the same store.
 */
export async function POST(req: Request) {
  const ctx = await mobileContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const code = await createWebHandoff(ctx.user.id, ctx.activeStoreId);
  const origin = new URL(req.url).origin;
  // Optional page to open after sign-in - a tapped notification (27 Sep 2026).
  // Only a path on this site: starts with one slash, never a scheme or //host.
  const body = (await req.json().catch(() => ({}))) as { next?: unknown };
  const next = safeNextPath(body.next);
  return NextResponse.json({ url: `${origin}/auth/handoff?code=${code}${next ? `&next=${encodeURIComponent(next)}` : ''}` });
}
