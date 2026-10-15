import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { whatsappPanel } from '@/server/document-send';
import { WhatsAppBusinessSend } from '@/components/document/WhatsAppBusinessSend';
import { guardSalesDoc } from '@/server/sales-reach';
import { getQuotationDetail } from '@/server/quotations';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { listAttachments } from '@/server/attachments';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { templateFor } from '@/server/document-templates';
import { QuotationViewClient } from './QuotationViewClient';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * View Quotation as a real page, not a dialog.
 *
 * A quotation is something people link to, bookmark and send to a colleague.
 * A dialog has no URL, so none of that works. The original gets this right and
 * it is worth copying.
 */
export default async function QuotationViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();

  const detail = await getQuotationDetail(ctx.scope, id);
  if (!detail) notFound();
  // Whose documents this person sees (B4 step 3).
  await guardSalesDoc(ctx, detail.salespersonId, `/quotation/${id}`);

  // Customers and products for the edit form load when it opens (PERF-2).
  const [store, categories, files, template] = await Promise.all([
    ctx.scope.kind === 'single'
      ? db.store.findUnique({ where: { id: ctx.scope.storeId }, select: { stateId: true } })
      : Promise.resolve(null),
    db.category.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true, parentId: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, codePrefix: true },
    }),
    listAttachments(ctx.scope, 'quotation', id),
    // The layout this branch prints quotations with (workstream C). Resolves
    // to Classic for any branch that has never chosen, so a new client's
    // first quotation prints correctly with no setup step.
    ctx.scope.kind === 'single'
      ? templateFor(ctx.scope.storeId, 'quotation')
      : templateFor('', 'quotation'),
  ]);

  // The trail walks forward from here - an accepted quotation shows the order
  // and invoice it became, which is the question somebody asks a month later.
  const trail = await documentTrail(ctx.scope, 'quotation', id);

  const wa = await whatsappPanel(ctx.scope, 'quotation', id);
  return (
    <>
      <DocumentTrail steps={trail} />
      {/* Send the PDF from the business WhatsApp number (A3). */}
      <WhatsAppBusinessSend type="quotation" id={id} {...wa} />
    <QuotationViewClient
      detail={detail}
      template={template.options}
      files={files}
      storeState={store?.stateId ?? null}
      categories={categories}
      canAddProduct={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      canEdit={ctx.permissions.has('quotation.create')}
    />
      <DocumentActivity table="Quotation" rowId={id} />
    </>
  );
}
