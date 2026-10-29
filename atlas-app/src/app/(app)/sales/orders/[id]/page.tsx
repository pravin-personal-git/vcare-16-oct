import { DocSerials } from '@/components/stock/DocSerials';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { whatsappPanel } from '@/server/document-send';
import { WhatsAppBusinessSend } from '@/components/document/WhatsAppBusinessSend';
import { guardSalesDoc } from '@/server/sales-reach';
import { getSalesOrderDetail } from '@/server/sales-orders';
import { listAttachments } from '@/server/attachments';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { OldSystemRemarks } from '@/components/document/OldSystemRemarks';
import { DocumentActivity } from '@/components/document/DocumentActivity';
import { SalesOrderDocument } from '../SalesOrderDocument';
import { InstallationStrip } from './InstallationStrip';

/**
 * ONE SALES ORDER (G-34, 10 Oct 2026). Pravin: "give its individual page".
 * The order used to open only as a pop-up over the list, so nothing could
 * link to it and Back closed the list too. Same document, same buttons - it
 * is the pop-up's component, rendered in the page.
 */
export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const order = await getSalesOrderDetail(ctx.scope, id);
  if (!order) notFound();
  // Whose documents this person sees (B4 step 3).
  await guardSalesDoc(ctx, order.salespersonId, `/sales/orders/${id}`);

  const [files, trail] = await Promise.all([
    listAttachments(ctx.scope, 'sales_order', id),
    documentTrail(ctx.scope, 'order', id),
  ]);

  const wa = await whatsappPanel(ctx.scope, 'order', id);
  return (
    <>
      <DocumentTrail steps={trail} />
      {/* Send the PDF from the business WhatsApp number (A3). */}
      <WhatsAppBusinessSend type="order" id={id} {...wa} />
      <InstallationStrip scope={ctx.scope} orderId={id} />
      <SalesOrderDocument id={id} initial={{ order, files }} />
      <DocSerials kind="order" id={id} canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('stock.adjust')} />
      <OldSystemRemarks table="SalesOrder" rowId={id} />
      <DocumentActivity table="SalesOrder" rowId={id} />
    </>
  );
}
