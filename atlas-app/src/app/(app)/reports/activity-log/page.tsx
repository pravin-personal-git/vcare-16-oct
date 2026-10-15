import { requireContext } from '@/server/context';
import { auditAreaCounts, auditPeople, auditTables, listAuditEvents, listSignInEvents, AUDIT_PAGE_SIZE, type AuditFilters } from '@/server/audit-log';
import { isAuditArea } from '@/lib/audit-areas';
import { ActivityClient } from './ActivityClient';

/**
 * The User Activity Log - every change to business records (recorded by the
 * database, so nothing can skip it) and every sign-in, sign-out and failed
 * password. Filtered and paged on the server (health check AUD-1).
 */
export default async function ActivityLogPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const tab = sp.tab === 'signins' ? 'signins' : 'changes';
  const page = Math.max(0, Number(sp.page) || 0);
  const day = (s?: string, end = false) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? '23:59:59' : '00:00:00'}+05:30`) : null);
  const area = isAuditArea(sp.area) || sp.area === 'other' ? sp.area : null;
  const f: AuditFilters = {
    area,
    person: sp.person || null, table: sp.table || null, action: sp.action || null,
    row: sp.row || null, q: sp.q?.trim() || null, from: day(sp.from), to: day(sp.to, true),
  };
  const storeIds = ctx.stores.map((s) => s.id);

  const [changes, signins, tables, people, areaCounts] = await Promise.all([
    tab === 'changes' ? listAuditEvents(ctx.scope, storeIds, f, page) : Promise.resolve({ rows: [], total: 0 }),
    tab === 'signins' ? listSignInEvents(ctx.scope, storeIds, f, page) : Promise.resolve({ rows: [], total: 0 }),
    auditTables(ctx.scope, storeIds),
    auditPeople(ctx.scope, storeIds),
    tab === 'changes' ? auditAreaCounts(ctx.scope, storeIds) : Promise.resolve(null),
  ]);

  const { scope } = ctx;
  const storeLabel = scope.kind === 'single' ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? 'this branch' : 'All Company';

  return (
    <ActivityClient
      tab={tab}
      page={page}
      pageSize={AUDIT_PAGE_SIZE}
      filters={{ area: area ?? '', person: sp.person ?? '', table: sp.table ?? '', action: sp.action ?? '', row: sp.row ?? '', q: sp.q ?? '', from: sp.from ?? '', to: sp.to ?? '' }}
      changes={changes}
      signins={signins}
      tables={tables}
      people={people}
      areaCounts={areaCounts}
      storeLabel={storeLabel}
    />
  );
}
