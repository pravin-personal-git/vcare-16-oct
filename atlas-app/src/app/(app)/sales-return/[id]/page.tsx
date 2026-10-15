import { ProductLink } from '@/components/document/ProductLink';
import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getReturnDetail } from '@/server/sales-returns';
import { Badge, Card, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import {
  DISPOSITION_LABEL, RETURN_REASON_LABEL, movesStock, type Disposition,
} from '@/lib/returns';
import { ReturnActions } from './ReturnActions';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * One return.
 *
 * The panel that earns its place is **What happened to the goods** - it states
 * per line whether the item went back on the shelf, and totals what did not.
 * Damaged stock that silently re-enters sellable inventory is the failure this
 * module exists to prevent, so the screen says out loud what was done rather
 * than leaving it implied by a dropdown nobody re-reads.
 */

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();
  const r = await getReturnDetail(ctx.scope, id);
  if (!r) notFound();

  const canEdit = ctx.scope.kind === 'single' && ctx.permissions.has('returns.edit');
  const canCredit = ctx.scope.kind === 'single' && ctx.permissions.has('returns.credit');

  const trail = await documentTrail(ctx.scope, 'return', r.id);
  const issued = r.creditNotes.filter((c) => c.lifecycle === 'issued');
  const notResellable = r.items.filter((i) => !movesStock(i.disposition as Disposition));
  const tax = r.items.reduce(
    (n, i) => n + Math.round((i.creditTaxablePaise * i.taxRatePct) / 100), 0,
  );

  return (
    <div>
      <DetailHeader
        icon="rotate-ccw"
        kind="Sales return"
        number={r.returnNo}
        status={r.lifecycle === 'cancelled' ? { label: 'Cancelled', tone: 'danger' }
          : r.lifecycle === 'draft' ? { label: 'Awaiting goods', tone: 'warning' } : { label: 'Received', tone: 'success' }}
        facts={[
          { label: 'Customer', value: <CustomerLink id={r.partyId} via={`return:${r.id}`}>{r.customerName}</CustomerLink> },
          { label: 'Invoice', value: <Link href={`/invoices/${r.invoiceId}`} className="font-mono text-brand hover:underline">{r.invoiceNo}</Link> },
          { label: 'Returned', value: fmtDate(r.returnedAt) },
        ]}
        backHref="/sales-return"
        actions={
          <ReturnActions
            id={r.id}
            returnNo={r.returnNo}
            lifecycle={r.lifecycle}
            hasIssuedCredit={issued.length > 0}
            canEdit={canEdit}
            canCredit={canCredit}
          />
        }
      />
      <DocumentTrail steps={trail} />

      {r.lifecycle === 'cancelled' && r.cancelReason && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">Cancelled.</strong> {r.cancelReason}
            {' '}Any stock this put back has been taken out again with a reversing movement -
            the original was not deleted.
          </p>
        </Card>
      )}

      {r.lifecycle === 'received' && issued.length === 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">No credit note has been issued.</strong>{' '}
            You have the goods and {r.customerName} still shows as owing{' '}
            {formatCurrency(r.valuePaise + tax)} for them. Until a credit note exists they
            will keep appearing on statements and reminders for stock already back on your shelf.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="What came back" icon="package" className="lg:col-span-2" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Of invoiced</th>
                  <th className="px-3 py-2 font-semibold">What happened to it</th>
                  <th className="px-3 py-2 text-right font-semibold">Credit due</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <ProductLink id={i.productId} className="block font-medium">{i.productName}</ProductLink>
                      {i.productCode && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {i.productCode}
                          {i.hsnCode && <span className="ms-2">HSN {i.hsnCode}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{i.qty}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                      {i.invoiceLineQty}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={movesStock(i.disposition as Disposition) ? 'success' : 'warning'}>
                        {DISPOSITION_LABEL[i.disposition] ?? i.disposition}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(i.creditTaxablePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Credit is a share of what each line was actually charged - after its own discount
            and after its share of any order-level discount. It is not quantity × price, which
            would refund more than the customer ever paid.
            {notResellable.length > 0 && (
              <span className="mt-1 block">
                <strong className="text-warning">
                  {notResellable.reduce((n, i) => n + i.qty, 0)} item
                  {notResellable.reduce((n, i) => n + i.qty, 0) === 1 ? '' : 's'} did not go back into stock.
                </strong>
                {' '}Damaged and scrapped goods are recorded but never made sellable again.
                The customer is still credited for them.
              </span>
            )}
          </div>
        </SectionCard>

        <div className="grid content-start gap-4">
          <SectionCard title="Credit" icon="receipt">
            <SummaryRow label="Goods value" value={formatCurrency(r.valuePaise)} />
            <SummaryRow
              label={r.taxMode === 'IGST' ? 'IGST' : 'CGST + SGST'}
              value={formatCurrency(tax)}
            />
            <SummaryRow label="Total credit due" value={formatCurrency(r.valuePaise + tax)} strong />

            <div className="mt-3 border-t border-border pt-3">
              {issued.length > 0 ? (
                <>
                  <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    Credit notes
                  </p>
                  {issued.map((c) => (
                    <Link
                      key={c.id}
                      href={`/credit-notes/${c.id}`}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="font-mono text-brand">{c.creditNoteNo}</span>
                      <span className="tabular-nums">{formatCurrency(c.grandTotalPaise)}</span>
                    </Link>
                  ))}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {r.lifecycle === 'received'
                    ? 'Nothing issued yet.'
                    : 'A credit note can be issued once the goods are received.'}
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Details" icon="info">
            <SummaryRow label="Reason" value={RETURN_REASON_LABEL[r.reason] ?? r.reason} />
            <SummaryRow label="Returned on" value={fmtDate(r.returnedAt)} />
            <SummaryRow
              label="Goods received"
              value={r.receivedAt ? fmtDate(r.receivedAt) : 'Not yet'}
            />
            {r.gstin && <SummaryRow label="Customer GSTIN" value={r.gstin} />}
            {r.notes && <SummaryRow label="Note" value={r.notes} />}
          </SectionCard>
        </div>
      </div>
      <DocumentActivity table="SalesReturn" rowId={id} />
    </div>
  );
}
