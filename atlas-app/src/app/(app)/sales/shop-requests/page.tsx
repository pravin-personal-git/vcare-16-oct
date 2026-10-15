import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { shopRequests } from '@/server/shop-requests';
import { ShopRequestsClient } from './ShopRequestsClient';

/**
 * Sales > Shop requests (13 Oct 2026): every request customers sent from the
 * online shop's "My list" - wanting to buy (a lead) or needing a visit (a
 * complaint) - with what it became and who has it. Pravin: "no one ever
 * knows what the customer requested". New ones also ring the bell.
 */
export default async function ShopRequestsPage() {
  const ctx = await requireContext();
  const can = (k: string) => ctx.permissions.has(k);
  if (!['leads.view', 'leads.edit', 'leads.create', 'complaints.view', 'complaints.edit'].some(can)) redirect('/dashboard');
  const rows = await shopRequests(ctx.scope);
  return (
    <ShopRequestsClient
      rows={rows}
      me={ctx.user.fullName}
      canPickUp={can('leads.edit') || can('leads.create')}
    />
  );
}
