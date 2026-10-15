import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { salesReach } from '@/server/sales-reach';
import { getCustomerLedger } from '@/server/customer-ledger';
import { customer360 } from '@/server/customer-360';
import { LedgerClient } from './LedgerClient';
import { listSites } from '@/server/sites';
import { SitesCard } from './SitesCard';
import { Customer360Client } from './Customer360Client';
import { CustomFieldsPanel } from '@/components/custom-fields/CustomFieldsPanel';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * A customer's page - their whole story (G-39, 10 Oct 2026), not only the
 * ledger it used to be. Built to the approved demo
 * (09-documentation/customer-360-demo.html).
 *
 * A real page, not a dialog: people send it to each other. The tab, the
 * ledger's date window (`from` / `to`) and where it was opened from
 * (`via=<kind>:<id>`) all live in the address, so a link reopens exactly
 * what was on screen.
 */
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; via?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();

  // Parsed here rather than trusted. An unparseable date becomes "no filter",
  // which shows the whole history - a wrong-but-complete statement is
  // recoverable, a silently-empty one is not.
  const parse = (v?: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const to = parse(sp.to);
  // Inclusive of the whole closing day. Without this a statement "to 31 March"
  // drops everything recorded that day, which is exactly when people record.
  if (to) to.setHours(23, 59, 59, 999);
  const dated = !!(sp.from || sp.to);

  const [ledger, allTime, data, sites] = await Promise.all([
    getCustomerLedger(ctx.scope, id, { from: parse(sp.from), to }),
    // "They owe" is always the whole account, whatever window the Ledger tab shows.
    dated ? getCustomerLedger(ctx.scope, id) : Promise.resolve(null),
    customer360(ctx.scope, id, sp.via, new Date(), await salesReach(ctx)),
    listSites(ctx.scope, id),
  ]);
  if (!ledger || !data) notFound();

  const canEdit = ctx.permissions.has('customers.edit');
  return (
    <Customer360Client
      data={data}
      owePaise={(allTime ?? ledger).closingPaise}
      canQuote={ctx.scope.kind === 'single' && ctx.permissions.has('quotation.create')}
      canPay={ctx.scope.kind === 'single' && ctx.permissions.has('accounts.edit')}
      canComplain={ctx.permissions.has('complaints.edit')}
      ledger={<LedgerClient ledger={ledger} embedded />}
      sites={<SitesCard partyId={id} sites={JSON.parse(JSON.stringify(sites))} canEdit={ctx.scope.kind === 'single' && canEdit} />}
      // Settings > Custom Fields - renders nothing when the branch has none.
      about={<CustomFieldsPanel entity="customer" id={id} canEdit={canEdit} className="border-t border-border p-4" />}
      history={<DocumentActivity table="Party" rowId={id} />}
    />
  );
}
