import { requirePortalContext } from '@/server/portal-context';
import { listMyComplaints, listMyPurchasedProducts, listMyComplaintFieldConfigs } from '@/server/portal';
import { fieldSetup } from '@/server/custom-fields';
import { ComplaintsClient } from './ComplaintsClient';

export default async function PortalComplaintsPage() {
  const ctx = await requirePortalContext();
  const [complaints, purchases, fieldConfigs, rules] = await Promise.all([
    listMyComplaints(ctx.party.id, ctx.party.storeId),
    listMyPurchasedProducts(ctx.party.id, ctx.party.storeId),
    listMyComplaintFieldConfigs(ctx.party.storeId),
    // The same Field rules the staff form obeys, so a customer is never asked
    // for something the business has switched off.
    // Read-only here: a customer never edits the rules, only obeys them.
    fieldSetup({ kind: 'single', storeId: ctx.party.storeId, writable: false }, 'complaint'),
  ]);
  return <ComplaintsClient complaints={complaints} purchases={purchases} fieldConfigs={fieldConfigs} rules={rules} />;
}
