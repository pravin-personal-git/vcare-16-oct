import { requireContext } from '@/server/context';
import { listApiTokens } from '@/server/api-tokens';
import { ApiTokensClient } from './ApiTokensClient';

/**
 * Workspace API tokens - backing both the "MCP Connector" and "ChatGPT/
 * OpenAI Connector" settings cards, which share one token system rather
 * than each inventing its own.
 */
export default async function ApiTokensPage() {
  const ctx = await requireContext();
  const tokens = await listApiTokens(ctx.organization.id);

  return (
    <ApiTokensClient
      tokens={tokens.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
      }))}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
