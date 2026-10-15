import 'server-only';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

/**
 * Short-lived signed access tokens for the `/api/v1` mobile/external API
 * (Platform-API-layer roadmap). Deliberately NOT stored anywhere - unlike
 * `LoginSession`/`MobileRefreshToken`, a JWT verifies itself by signature and
 * expiry, so most API requests need no database round trip at all. Only the
 * refresh token (`server/auth/mobile-tokens.ts`) touches the database, and
 * only on `/refresh` or `/logout`.
 *
 * Reuses `SESSION_SECRET` rather than asking for a second production secret -
 * this app already treats it as the one general-purpose signing key
 * (`server/auth/elevation.ts` does the same for its reauth cookie).
 */

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type ApiCallerKind = 'user' | 'party';

export interface AccessTokenPayload {
  sub: string;
  kind: ApiCallerKind;
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set - required for /api/v1 access tokens.');
  return new TextEncoder().encode(s);
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ kind: payload.kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

/** Null for anything invalid, expired or malformed - callers never need to distinguish why. */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || (payload.kind !== 'user' && payload.kind !== 'party')) return null;
    return { sub: payload.sub, kind: payload.kind };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired || err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return null;
    }
    if (err instanceof joseErrors.JOSEError) return null;
    throw err;
  }
}

export { ACCESS_TOKEN_TTL_SECONDS };
