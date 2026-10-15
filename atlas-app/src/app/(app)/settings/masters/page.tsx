import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { listMasters, MASTER_KINDS, type MasterKind } from '@/server/administration';
import { MastersClient } from './MastersClient';

const KEYS = new Set(MASTER_KINDS.map((k) => k.kind));

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const ctx = await requireContext();
  const { list } = await searchParams;

  const activeKind: MasterKind = list && KEYS.has(list as MasterKind)
    ? (list as MasterKind)
    : 'category';

  const scopeIsAll = ctx.scope.kind === 'all';

  // In All Company the lists are ambiguous - each branch keeps its own - so the
  // screen explains that rather than merging twelve stores' dropdowns into one
  // list nobody can edit.
  const [items, parents] = scopeIsAll
    ? [[], []]
    : await Promise.all([
      listMasters(ctx.scope, activeKind),
      db.category.findMany({
        where: { ...scopeWhere(ctx.scope), parentId: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

  // Destructured so the narrowing survives into the callback - TypeScript will
  // not carry `ctx.scope.kind === 'single'` through a property access.
  const { scope } = ctx;
  const storeName = scope.kind === 'single'
    ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? ''
    : '';

  return (
    <MastersClient
      kinds={MASTER_KINDS}
      activeKind={activeKind}
      items={items}
      parents={parents}
      canEdit={ctx.permissions.has('settings.edit')}
      scopeIsAll={scopeIsAll}
      storeName={storeName}
    />
  );
}
