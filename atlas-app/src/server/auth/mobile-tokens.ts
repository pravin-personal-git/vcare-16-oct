import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS, type ApiCallerKind } from './jwt';

/**
 * Refresh-token issuing/rotation for the `/api/v1` mobile API - one pair of
 * functions covering both `MobileRefreshToken` (staff/owner `User`) and
 * `PartyRefreshToken` (portal customer `Party`), since the two tables are
 * identical in shape and behaviour, only the parent model differs. See
 * PLATFORM-API-LAYER.md §3/§4.
 *
 * 60-day SLIDING expiry (decided 2026-09-22, see MOBILE-APP-ROADMAP.md): a
 * phone in daily use never re-prompts for a password. Every successful
 * `/refresh` extends `expiresAt` another 60 days rather than issuing a fixed
 * end date - the only ways a session actually ends are 60+ days of no use,
 * an explicit logout, or the account owner revoking that device.
 *
 * A lost /refresh reply is NOT one of those ways (15 Oct 2026, a Vcare
 * technician signed out again and again on a weak signal): the server had
 * rotated the token but the phone never got the new one, so its next try
 * sent the old one and was refused. Rotation now records `replacedById`, and
 * an old token is honoured again while its replacement has never been used -
 * see `rotateRow`.
 */

const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token lifetime, seconds - lets a client pre-emptively refresh
}

async function issueRefreshToken(
  kind: ApiCallerKind, subjectId: string, deviceLabel: string | null,
): Promise<{ raw: string; id: string }> {
  const raw = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const row = kind === 'user'
    ? await db.mobileRefreshToken.create({
      data: { userId: subjectId, tokenHash: hash(raw), deviceLabel, expiresAt }, select: { id: true },
    })
    : await db.partyRefreshToken.create({
      data: { partyId: subjectId, tokenHash: hash(raw), deviceLabel, expiresAt }, select: { id: true },
    });
  return { raw, id: row.id };
}

async function issuePair(
  kind: ApiCallerKind, subjectId: string, deviceLabel: string | null,
): Promise<{ pair: TokenPair; refreshId: string }> {
  const [accessToken, refresh] = await Promise.all([
    signAccessToken({ sub: subjectId, kind }),
    issueRefreshToken(kind, subjectId, deviceLabel),
  ]);
  return {
    pair: { accessToken, refreshToken: refresh.raw, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    refreshId: refresh.id,
  };
}

/** Called right after a successful login (password or OTP), of either kind. */
export async function issueTokenPair(
  kind: ApiCallerKind, subjectId: string, deviceLabel: string | null = null,
): Promise<TokenPair> {
  return (await issuePair(kind, subjectId, deviceLabel)).pair;
}

export class RefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshTokenError';
  }
}

/**
 * Trades a still-valid refresh token for a new access token AND rotates the
 * refresh token itself (old one revoked, new one issued) - standard
 * refresh-token rotation, so a leaked refresh token has a short useful
 * window before its next legitimate use invalidates it.
 *
 * The caller does not need to say whether this is a staff or a customer
 * token - a 32-byte random hex value cannot plausibly collide between the
 * two tables, so this just checks both (same "try each kind" shape
 * `requireApiCaller` already uses for device/user/party).
 */
export async function rotateRefreshToken(rawToken: string): Promise<TokenPair> {
  const tokenHash = hash(rawToken);

  const userRow = await db.mobileRefreshToken.findUnique({ where: { tokenHash } });
  if (userRow) return rotateRow('user', { ...userRow, subjectId: userRow.userId });

  const partyRow = await db.partyRefreshToken.findUnique({ where: { tokenHash } });
  if (partyRow) return rotateRow('party', { ...partyRow, subjectId: partyRow.partyId });

  throw new RefreshTokenError(EXPIRED);
}

const EXPIRED = 'This session has expired. Please sign in again.';

interface TokenRow {
  id: string;
  subjectId: string;
  deviceLabel: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/**
 * The rotation itself, both kinds.
 *
 * A token already revoked is refused, with ONE exception: it was revoked by a
 * rotation (`replacedById` set) and the token that replaced it has never been
 * used or revoked. That is exactly a lost reply - the phone still holds the old
 * token because the new one never arrived - so the unused replacement is
 * retired and a fresh pair issued in its place.
 *
 * Everything else still ends the session:
 * - logout revokes without `replacedById`;
 * - "revoke this person's devices" and password changes revoke every live
 *   token, the replacement included;
 * - once the replacement has been used, its own rotation revokes it, so a
 *   copied old token can never run alongside the real phone.
 */
async function rotateRow(kind: ApiCallerKind, row: TokenRow): Promise<TokenPair> {
  const now = new Date();
  if (row.expiresAt < now) throw new RefreshTokenError(EXPIRED);

  let unusedReplacement: string | null = null;
  if (row.revokedAt) {
    if (!row.replacedById) throw new RefreshTokenError(EXPIRED);
    const next = kind === 'user'
      ? await db.mobileRefreshToken.findUnique({ where: { id: row.replacedById }, select: { revokedAt: true } })
      : await db.partyRefreshToken.findUnique({ where: { id: row.replacedById }, select: { revokedAt: true } });
    if (!next || next.revokedAt) throw new RefreshTokenError(EXPIRED);
    unusedReplacement = row.replacedById;
  }

  const { pair, refreshId } = await issuePair(kind, row.subjectId, row.deviceLabel);
  const old = { revokedAt: row.revokedAt ?? now, lastUsedAt: now, replacedById: refreshId };
  const gone = { revokedAt: now, replacedById: refreshId };
  if (kind === 'user') {
    await db.$transaction([
      db.mobileRefreshToken.update({ where: { id: row.id }, data: old }),
      ...(unusedReplacement ? [db.mobileRefreshToken.update({ where: { id: unusedReplacement }, data: gone })] : []),
    ]);
  } else {
    await db.$transaction([
      db.partyRefreshToken.update({ where: { id: row.id }, data: old }),
      ...(unusedReplacement ? [db.partyRefreshToken.update({ where: { id: unusedReplacement }, data: gone })] : []),
    ]);
  }
  return pair;
}

/**
 * Logout - revokes one specific refresh token. Idempotent: revoking an
 * already-revoked or unknown token is not an error. `$transaction`, not
 * `Promise.all` - a single pooled connection (`connection_limit=1`)
 * serialises concurrent queries anyway, so a batch costs one round trip
 * instead of two.
 */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hash(rawToken);
  await db.$transaction([
    db.mobileRefreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.partyRefreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
