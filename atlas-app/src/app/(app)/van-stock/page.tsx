import { requireContext } from '@/server/context';
import { listVans, vanHolderOptions, vanShift } from '@/server/van-stock';
import { VanStockClient } from './VanStockClient';

/**
 * What each technician is carrying, and whether it adds up.
 *
 * The shift of whichever van is selected is loaded on the server rather than
 * fetched afterwards, so the page arrives complete. A storeman at six in the
 * evening with twelve vans coming in does not want a spinner per van.
 */
export default async function VanStockPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const vans = await listVans(ctx.scope);
  const selectedId = sp.van && vans.some((v) => v.id === sp.van) ? sp.van : vans[0]?.id ?? null;

  const [holders, shift] = await Promise.all([
    vanHolderOptions(ctx.scope),
    selectedId ? vanShift(ctx.scope, selectedId).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <VanStockClient
      vans={vans}
      holders={holders}
      selectedId={selectedId}
      shift={shift}
      canManage={ctx.scope.kind === 'single' && ctx.permissions.has('stock.adjust')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
