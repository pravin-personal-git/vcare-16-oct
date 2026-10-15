import { notFound } from 'next/navigation';
import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { listAuditEvents } from '@/server/platform-admin';
import { AuditClient } from './AuditClient';

/**
 * Superadmin-roadmap Slice 9 - filterable `PrivilegedAccessEvent` viewer.
 * Read-only by construction: no delete route exists anywhere in
 * `platform-admin.ts` for this model, matching "audit events must not be
 * deletable through ordinary admin screens."
 */
export default async function PlatformAuditPage() {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformAudit.view')) notFound();

  const scope = await resolveBestOrgScope(ctx.memberships);
  // No cross-tenant scope at all (a TENANT/LEGAL_ENTITY-only membership) -
  // same "nothing to show" response as `/platform/tenants` gives.
  const events = scope ? await listAuditEvents(scope, {}) : [];

  return (
    <AuditClient events={events.map((e) => ({ ...e, startedAt: e.startedAt.toISOString() }))} />
  );
}
