import { NextResponse } from 'next/server';
import { rotateRefreshToken, RefreshTokenError } from '@/server/auth/mobile-tokens';

/** Trades a refresh token for a new token pair, rotating it - works for both staff and customer tokens. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const refreshToken = String(body?.refreshToken ?? '');

  if (!refreshToken) {
    return NextResponse.json({ error: 'Missing refreshToken.' }, { status: 400 });
  }

  try {
    const tokens = await rotateRefreshToken(refreshToken);
    return NextResponse.json(tokens);
  } catch (err) {
    if (err instanceof RefreshTokenError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error('[api/v1/auth/refresh]', err);
    return NextResponse.json({ error: 'Could not refresh your session. Please sign in again.' }, { status: 500 });
  }
}
