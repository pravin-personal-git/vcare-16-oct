import { requireContext } from '@/server/context';
import { listHelpdeskCategories, getHelpdeskDashboard } from '@/server/helpdesk';
import { HELPDESK_LIST, runCardList } from '@/server/card-lists';
import { HelpdeskClient } from './HelpdeskClient';

export default async function HelpdeskPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const canViewAll = ctx.permissions.has('helpdesk.view') || ctx.permissions.has('helpdesk.edit');
  const viewer = { userId: ctx.user.id, canViewAll };

  const [tickets, categories, dashboard] = await Promise.all([
    HELPDESK_LIST.load(ctx),
    listHelpdeskCategories(ctx.scope, { activeOnly: true }),
    getHelpdeskDashboard(ctx.scope, viewer),
  ]);

  // ?status=, ?mine=1, search and page all run here (F1b server paging, 6 Oct 2026).
  const list = runCardList(HELPDESK_LIST, tickets, sp, ctx);
  const statuses = ['open', 'in_progress', 'resolved', 'closed'];

  return (
    <HelpdeskClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      statusFilter={sp.status && statuses.includes(sp.status) ? sp.status : 'all'}
      mineOnly={sp.mine === '1'}
      tickets={list.rows.map((t) => ({
        ...t,
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
        closedAt: t.closedAt ? t.closedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      }))}
      categories={categories}
      dashboard={dashboard}
      currentUserId={ctx.user.id}
      canViewAll={canViewAll}
      canManage={ctx.permissions.has('helpdesk.edit')}
    />
  );
}
