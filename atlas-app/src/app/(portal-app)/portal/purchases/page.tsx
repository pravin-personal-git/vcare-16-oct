import { requirePortalContext } from '@/server/portal-context';
import { listMyInvoices } from '@/server/portal';
import { PurchasesClient } from './PurchasesClient';

export default async function PortalPurchasesPage() {
  const ctx = await requirePortalContext();
  const invoices = await listMyInvoices(ctx.party.id, ctx.party.storeId);
  return <PurchasesClient invoices={invoices} />;
}
