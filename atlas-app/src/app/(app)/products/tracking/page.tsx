import { requireContext } from '@/server/context';
import { listTrackingRows } from '@/server/stock-tracking';
import { TrackingClient } from './TrackingClient';

export default async function ProductTrackingPage({ searchParams }: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const rows = await listTrackingRows(ctx.scope);

  return (
    <TrackingClient
      rows={rows}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      initialSearch={sp.q ?? ''}
      // `?filter=service` lands on the charges held back as services - the
      // one list somebody is asked to review after a classification pass.
      initialFilter={sp.filter ?? null}
    />
  );
}
