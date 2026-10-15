import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { backToHandOver, listDispatches, readyToSend } from '@/server/supplier-dispatch';
import { DispatchClient } from './DispatchClient';

/**
 * SUPPLIER DISPATCH (10 Oct 2026, repair flow stage 4) - the store's board:
 * what is waiting to go (by supplier), what is out (by box), what has come
 * back and still has to reach the customer.
 */
export default async function SupplierDispatchPage() {
  const ctx = await requireContext();
  const [ready, out, back, suppliers] = await Promise.all([
    readyToSend(ctx.scope),
    listDispatches(ctx.scope),
    backToHandOver(ctx.scope),
    db.party.findMany({
      where: { ...scopeWhere(ctx.scope), isSupplier: true, status: 'active' },
      select: { id: true, title: true, firstName: true, lastName: true, companyName: true },
      orderBy: { firstName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
  ]);
  // Through JSON, so every date reaches the client as an ISO string.
  const iso = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
  return (
    <DispatchClient
      ready={iso<Parameters<typeof DispatchClient>[0]['ready']>(ready)}
      dispatches={iso<Parameters<typeof DispatchClient>[0]['dispatches']>(out)}
      back={iso<Parameters<typeof DispatchClient>[0]['back']>(back)}
      suppliers={suppliers.map((p) => ({ id: p.id, name: p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim() }))}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('complaints.edit')}
    />
  );
}
