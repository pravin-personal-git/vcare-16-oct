import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';

/**
 * Workspace-level API tokens - for an external agent (an MCP-style
 * connector, a ChatGPT/OpenAI integration) to authenticate against this
 * organisation's data, not a person signing into the product.
 *
 * Same trust model as `CallSyncDevice`/`AttendanceDevice`: the token is
 * shown once at creation and never stored - only its SHA-256 hash is, so a
 * leaked database cannot hand over a working credential.
 */

export class ApiTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTokenError';
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ApiTokenRow {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export async function listApiTokens(organizationId: string): Promise<ApiTokenRow[]> {
  return db.apiToken.findMany({
    where: { organizationId },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
}

/** Returns the raw token once - it is never recoverable after this. */
export async function createApiToken(
  organizationId: string, label: string, createdBy: string,
): Promise<{ id: string; token: string }> {
  if (!label.trim()) throw new ApiTokenError('Give the token a label.');

  const token = randomBytes(32).toString('hex');
  const row = await db.apiToken.create({
    data: { organizationId, label: label.trim(), tokenHash: hash(token), createdBy },
    select: { id: true },
  });
  return { id: row.id, token };
}

export async function revokeApiToken(organizationId: string, id: string, userId: string): Promise<void> {
  const updated = await db.apiToken.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: userId },
  });
  if (updated.count === 0) throw new ApiTokenError('Token not found, or already revoked.');
}

export interface AuthedApiToken {
  id: string;
  organizationId: string;
  organizationName: string;
}

/** Resolve a bearer token. Null for anything not currently valid. Touches `lastUsedAt` best-effort. */
export async function apiTokenFromBearer(token: string): Promise<AuthedApiToken | null> {
  if (!token) return null;

  const row = await db.apiToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, organizationId: true, revokedAt: true, organization: { select: { name: true } } },
  });
  if (!row || row.revokedAt) return null;

  void db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

  return { id: row.id, organizationId: row.organizationId, organizationName: row.organization.name };
}
