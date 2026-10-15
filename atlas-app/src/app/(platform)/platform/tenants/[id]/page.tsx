import { notFound, redirect } from 'next/navigation';
import { requirePlatformContext } from '@/server/platform-context';
import { isOrgInMembershipScope } from '@/server/platform-scope';
import { getTenantDetail, hideablePages, listTenantUsers, listAuditEvents } from '@/server/platform-admin';
import { TenantDetailClient } from './TenantDetailClient';

/**
 * Superadmin-roadmap Slice 9 - "where slices 5-8's controls actually live."
 * `/platform/tenants` keeps its own inline Manage/Access-Tenant buttons
 * (Slices 5/6 shipped them there first, ahead of this page existing, and
 * removing working, already-verified controls for no functional gain would
 * be pure churn) - this page is the fuller destination: branch list,
 * feature flags, credential actions and a per-tenant activity feed, none of
 * which had anywhere to live until now.
 */
export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePlatformContext();

  if (!(await isOrgInMembershipScope(ctx.memberships, id))) {
    redirect('/platform/tenants');
  }

  const tenant = await getTenantDetail(id);
  if (!tenant) notFound();

  const canManageCredentials = ctx.permissions.has('platformTenant.manageCredentials');
  const canViewAudit = ctx.permissions.has('platformAudit.view');

  // Sequential, not Promise.all - a single pooled connection
  // (`connection_limit=1`) serialises concurrent queries anyway, so racing
  // them here costs the same round trips for more complexity.
  const users = canManageCredentials ? await listTenantUsers(id) : [];
  // The pages the owner may switch off for this client, read from the real
  // menu so the list cannot drift from what the client actually sees (F-01).
  const pages = ctx.permissions.has('platformTenant.manageFlags') ? await hideablePages() : [];
  const auditEvents = canViewAudit ? await listAuditEvents({ kind: 'tenant', organizationId: id }, {}) : [];

  return (
    <TenantDetailClient
      tenant={{
        ...tenant,
        createdAt: tenant.createdAt.toISOString(),
        scheduledLockAt: tenant.scheduledLockAt?.toISOString() ?? null,
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
        businessesCreated: tenant.businessesCreated.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
      }}
      users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
      auditEvents={auditEvents.map((e) => ({ ...e, startedAt: e.startedAt.toISOString() }))}
      canManageLifecycle={ctx.permissions.has('platformTenant.suspend')}
      canAccessTenant={ctx.permissions.has('platformTenant.access')}
      canManageCredentials={canManageCredentials}
      canManageFlags={ctx.permissions.has('platformTenant.manageFlags')}
      canViewAudit={canViewAudit}
      pages={pages}
    />
  );
}
