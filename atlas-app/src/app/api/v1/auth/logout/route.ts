import { NextResponse } from 'next/server';
import { revokeRefreshToken } from '@/server/auth/mobile-tokens';
import { markPushTokenSignedOut } from '@/server/notify';

/**
 * Revokes the given refresh token. Always 200 - logout is not a place to leak
 * whether a token existed.
 *
 * SINCE 10 OCT 2026 IT ALSO TELLS US THE PHONE IS EMPTY (F-05).
 *
 * `pushToken` is optional and the phone sends the Expo token it registered.
 * Nothing is deleted: the row is marked `signedOut`, Urgent alerts keep
 * ringing it, and `server/notify.sendPush` strips every word of business
 * detail out of them until somebody signs in again. Before this, an Urgent
 * push went on arriving with its real title and body on a phone with no
 * session, because Expo has no idea whether an app is signed in.
 *
 * NOT GATED BY AN ACCESS TOKEN, deliberately. This is called during sign-out,
 * which is exactly when an access token may already have expired - a gate
 * here would fail in the case it exists for. And the call can only REDUCE
 * what a phone receives, never widen it: the worst somebody could do with a
 * push token they already hold is quieten their own notifications until the
 * app next opens, which clears the flag anyway.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const refreshToken = String(body?.refreshToken ?? '');
  if (refreshToken) await revokeRefreshToken(refreshToken).catch(() => undefined);

  const pushToken = String(body?.pushToken ?? '');
  if (pushToken) await markPushTokenSignedOut(pushToken).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
