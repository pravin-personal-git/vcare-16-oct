import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { listResellers } from '@/server/platform-admin';
import { EmptyState, PageHeader, Card } from '@/components/ui/Layout';
import { ResellersClient } from './ResellersClient';

export default async function PlatformResellersPage() {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformReseller.view')) {
    return (
      <div>
        <PageHeader badge="RS" title="Resellers" />
        <Card>
          <EmptyState icon="building" title="Not available" hint="Your role does not include reseller visibility." />
        </Card>
      </div>
    );
  }

  const scope = await resolveBestOrgScope(ctx.memberships);
  const resellers = scope ? await listResellers(scope) : [];

  // Creating a reseller needs the id of the PLATFORM/RESELLER account the
  // new one is parented under - same lookup as the tenants page.
  const parentAccountId =
    ctx.memberships.find((m) => m.scopeType === 'PLATFORM' || m.scopeType === 'RESELLER')
      ?.platformAccountId ?? null;

  return (
    <ResellersClient
      resellers={resellers.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      canCreate={ctx.permissions.has('platformReseller.create')}
      parentAccountId={parentAccountId}
    />
  );
}
