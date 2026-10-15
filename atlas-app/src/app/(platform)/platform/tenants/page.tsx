import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { listTenants } from '@/server/platform-admin';
import { EmptyState, PageHeader, Card } from '@/components/ui/Layout';
import { TenantsClient } from './TenantsClient';

export default async function PlatformTenantsPage() {
  const ctx = await requirePlatformContext();
  const scope = await resolveBestOrgScope(ctx.memberships);

  if (!scope) {
    return (
      <div>
        <PageHeader badge="PT" title="Tenants" />
        <Card>
          <EmptyState
            icon="building"
            title="No platform or reseller membership"
            hint="Your account has no scope over any tenant. Contact whoever granted your access."
          />
        </Card>
      </div>
    );
  }

  const tenants = await listTenants(scope);

  return (
    <TenantsClient
      tenants={tenants.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        scheduledLockAt: t.scheduledLockAt?.toISOString() ?? null,
      }))}
      canCreate={ctx.permissions.has('platformTenant.create')}
      canAccessTenant={ctx.permissions.has('platformTenant.access')}
      canManageLifecycle={ctx.permissions.has('platformTenant.suspend')}
      // The account this Owner/Reseller's new tenants attach to - the
      // widest scope resolves to `platform`/`resellerSubtree`, neither of
      // which names one account directly, so the PLATFORM/RESELLER
      // membership itself carries the id to create under.
      platformAccountId={
        ctx.memberships.find((m) => m.scopeType === 'PLATFORM' || m.scopeType === 'RESELLER')
          ?.platformAccountId ?? null
      }
    />
  );
}
