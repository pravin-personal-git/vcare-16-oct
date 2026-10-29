import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getEnquiryPage } from '@/server/enquiry-page';
import { visibleAssigneeFilter } from '@/server/complaint-visibility';
import { EnquiryView } from './EnquiryView';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * One enquiry on its own page (29 Oct 2026, Vcare: the pop-up was "messy";
 * give it a page like installations). Same scope and "Leads they see" rule
 * as the pop-up it replaces.
 */
export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await getEnquiryPage(ctx.scope, id);
  if (!d) notFound();
  const visible = await visibleAssigneeFilter(ctx, 'leads');
  if (visible && !visible(d.assignedToUserId ?? null)) notFound();

  const iso = (x: Date) => x.toISOString();
  return (
    <>
      <EnquiryView
        d={{
          ...d,
          sinceDate: iso(d.sinceDate), lastTalkAt: d.lastTalkAt && iso(d.lastTalkAt), nextActionAt: d.nextActionAt && iso(d.nextActionAt),
          notes: d.notes.map((n) => ({ ...n, createdAt: iso(n.createdAt) })),
          comments: d.comments.map((n) => ({ ...n, createdAt: iso(n.createdAt) })),
          activities: d.activities.map((a) => ({ ...a, occurredAt: iso(a.occurredAt) })),
          quotations: d.quotations.map((q) => ({ ...q, quotationDate: iso(q.quotationDate) })),
          orders: d.orders.map((o) => ({ ...o, orderDate: iso(o.orderDate) })),
          installations: d.installations.map((i) => ({ ...i, createdAt: iso(i.createdAt) })),
          invoices: d.invoices.map((b) => ({ ...b, invoiceDate: iso(b.invoiceDate) })),
          stageChanges: d.stageChanges.map((s) => ({ ...s, at: iso(s.at) })),
        }}
        canEdit={ctx.permissions.has('leads.edit') && ctx.scope.kind === 'single'}
        canNote={ctx.scope.kind === 'single'}
        canConvert={ctx.permissions.has('customers.create') && ctx.scope.kind === 'single'}
      />
      <DocumentActivity table="Lead" rowId={id} />
    </>
  );
}
