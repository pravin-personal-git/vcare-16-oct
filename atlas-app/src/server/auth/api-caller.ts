import 'server-only';
import { db } from '../db';
import { verifyAccessToken } from './jwt';
import { apiTokenFromBearer } from '../api-tokens';

/**
 * The one auth check every `/api/v1` route needs - tries all three caller
 * kinds this platform now has, per PLATFORM-API-LAYER.md §3:
 *   - `device`  - an `ApiToken` bearer (the offline-sync agent / MCP-style connector)
 *   - `user`    - a signed access token for a staff/owner `User`
 *   - `party`   - a signed access token for a portal customer `Party`
 * Returns `null` for anything not currently valid; route handlers respond
 * 401 themselves rather than this throwing, matching every other auth
 * resolver in this codebase (`getContext`, `getPlatformContext`, ...).
 */

export type ApiCaller =
  | { kind: 'device'; organizationId: string; organizationName: string }
  | { kind: 'user'; userId: string; organizationId: string | null; fullName: string; username: string }
  | { kind: 'party'; partyId: string; organizationId: string; firstName: string };

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

export async function requireApiCaller(req: Request): Promise<ApiCaller | null> {
  const token = bearer(req);
  if (!token) return null;

  // Device tokens are a fixed-format hash lookup - cheap, and tried first so
  // an offline-sync-agent request never pays for a JWT parse it doesn't need.
  const device = await apiTokenFromBearer(token);
  if (device) {
    return { kind: 'device', organizationId: device.organizationId, organizationName: device.organizationName };
  }

  const payload = await verifyAccessToken(token);
  if (!payload) return null;

  if (payload.kind === 'user') {
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, fullName: true, username: true, organizationId: true, isActive: true },
    });
    if (!user || !user.isActive) return null;
    return {
      kind: 'user', userId: user.id, organizationId: user.organizationId,
      fullName: user.fullName, username: user.username,
    };
  }

  // `Party` has no `Store` relation object defined, only the scalar
  // `storeId` - a second lookup rather than a nested select.
  const party = await db.party.findUnique({
    where: { id: payload.sub },
    select: { id: true, firstName: true, portalEnabled: true, storeId: true },
  });
  if (!party || !party.portalEnabled) return null;

  const store = await db.store.findUnique({ where: { id: party.storeId }, select: { organizationId: true } });
  if (!store) return null;

  return { kind: 'party', partyId: party.id, organizationId: store.organizationId, firstName: party.firstName };
}
