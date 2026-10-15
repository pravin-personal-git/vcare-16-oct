import { requireContext } from '@/server/context';
import { listPolicies } from '@/server/internal-policies';
import { TermsClient } from './TermsClient';

export default async function TermsPage() {
  const ctx = await requireContext();
  const policies = await listPolicies(ctx.scope, ctx.user.id);

  return (
    <TermsClient
      policies={policies.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }))}
      canEdit={ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
