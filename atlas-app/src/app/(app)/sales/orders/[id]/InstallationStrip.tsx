import Link from 'next/link';
import { db } from '@/server/db';
import { scopeWhere, type StoreScope } from '@/server/store-scope';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/button-class';
import { freeOrderLines, stageLabel } from '@/lib/installation-stages';

/**
 * The installations an order already has (11 Oct 2026, ops-pages demo tab 1).
 * Each one opens its page; "Create installation" only appears on the list
 * while some line is not yet on one (one line, one installation).
 */
export async function InstallationStrip({ scope, orderId }: { scope: StoreScope; orderId: string }) {
  const so = await db.salesOrder.findFirst({
    where: { id: orderId, ...scopeWhere(scope) },
    select: {
      items: { select: { id: true, productId: true, productName: true } },
      installationChallans: {
        where: { deletedAt: null }, orderBy: { dispatchedAt: 'asc' },
        select: {
          id: true, challanNo: true, stage: true,
          items: { select: { salesOrderItemId: true, productId: true, productName: true, fitStatus: true, qty: true } },
          assignees: { select: { user: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!so || so.installationChallans.length === 0) return null;
  const { free } = freeOrderLines(so.items, so.installationChallans);
  return (
    <div className="no-print mb-3 space-y-2">
      {so.installationChallans.map((c) => {
        const fitted = c.items.filter((i) => i.fitStatus !== 'to_fit').length;
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded bg-brand/5 p-3 ring-1 ring-brand/20">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="home" className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Installation {c.challanNo}</p>
              <p className="text-xs text-muted-foreground">
                {stageLabel(c.stage)} · {fitted} of {c.items.length} item{c.items.length === 1 ? '' : 's'} fitted
                {c.assignees.length ? ` · ${c.assignees.map((a) => a.user.fullName).join(', ')}` : ''}
              </p>
            </div>
            <Link href={`/services/installations/${c.id}`} className={buttonClass('primary', 'sm')}>Open installation <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
          </div>
        );
      })}
      {free.length > 0 && (
        <p className="text-xs text-muted-foreground">{free.length} line{free.length === 1 ? ' is' : 's are'} not on an installation yet - raise another from the orders list (⋮ → Create installation job).</p>
      )}
    </div>
  );
}
