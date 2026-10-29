import { DocSerials } from '@/components/stock/DocSerials';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { whatsappPanel } from '@/server/document-send';
import { WhatsAppBusinessSend } from '@/components/document/WhatsAppBusinessSend';
import { guardSalesDoc } from '@/server/sales-reach';
import { getInvoiceDetail } from '@/server/invoices';
import { listAttachments } from '@/server/attachments';
import { listRevisions } from '@/server/invoices';
import { db } from '@/server/db';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { InvoiceViewClient } from './InvoiceViewClient';
import { DocumentActivity } from '@/components/document/DocumentActivity';

export default async function InvoiceViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();

  const detail = await getInvoiceDetail(ctx.scope, id);
  if (!detail) notFound();
  // Whose documents this person sees (B4 step 3).
  await guardSalesDoc(ctx, detail.salespersonId, `/invoices/${id}`);

  // Customers and products for the edit form load when it opens (PERF-2).
  const [files, revisions, store, trail] = await Promise.all([
    listAttachments(ctx.scope, 'invoice', id),
    listRevisions(ctx.scope, id),
    ctx.scope.kind === 'single'
      ? db.store.findUnique({ where: { id: ctx.scope.storeId }, select: { stateId: true } })
      : Promise.resolve(null),
    documentTrail(ctx.scope, 'invoice', id),
  ]);

  const wa = await whatsappPanel(ctx.scope, 'invoice', id);
  return (
    <>
      {/* Above the document, not below it. "Where am I in this sale and what
          happens next" is the question somebody has BEFORE they read the
          invoice, not after. */}
      <DocumentTrail steps={trail} />
      {/* Send the PDF from the business WhatsApp number (A3). */}
      <WhatsAppBusinessSend type="invoice" id={id} {...wa} />
    <InvoiceViewClient
      detail={detail}
      files={files}
      revisions={revisions}
      storeState={store?.stateId ?? null}
      canIssue={ctx.permissions.has('invoice.create')}
      canApprove={ctx.permissions.has('invoice.approve')}
      canSeeCosts={ctx.permissions.has('invoice.costTrail')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
      <DocSerials kind="invoice" id={id} canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('stock.adjust')} />
      <DocumentActivity table="Invoice" rowId={id} />
    </>
  );
}
