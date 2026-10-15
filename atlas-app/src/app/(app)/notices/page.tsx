import { requireContext } from '@/server/context';
import { NOTICE_LIST, runCardList } from '@/server/card-lists';
import { NoticesClient } from './NoticesClient';

export default async function NoticesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const notices = await NOTICE_LIST.load(ctx);
  // ?show= active (default) | expired | all, then search and page - all here (F1b server paging).
  const list = runCardList(NOTICE_LIST, notices, sp, ctx);

  return (
    <NoticesClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      show={sp.show === 'expired' || sp.show === 'all' ? sp.show : 'active'}
      notices={list.rows.map((n) => ({
        ...n,
        expiresAt: n.expiresAt ? n.expiresAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      }))}
      canEdit={ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
