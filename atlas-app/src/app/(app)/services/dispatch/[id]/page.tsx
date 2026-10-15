import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireContext } from '@/server/context';
import { dispatchDetail } from '@/server/supplier-dispatch';
import { DetailHeader } from '@/components/document/DetailHeader';
import { DISPATCH_STATUS_LABEL, COURIER_PAID_BY_LABEL, type DispatchStatus, type CourierPaidBy } from '@/lib/supplier-dispatch';
import { BoxItems } from './BoxItems';
import type { BadgeTone } from '@/components/ui/Layout';

/**
 * ONE BOX TO ONE SUPPLIER (10 Oct 2026, repair flow stage 4): courier,
 * docket, tracking, charge, the delivery challan, and each item inside with
 * its own result and the complaint it came from.
 */
const day = (x: Date | null) => (x ? x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const rupees = (p: number | null) => (p ? `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '-');
const TONE: Record<string, BadgeTone> = { sent: 'info', part_back: 'warning', back: 'success', cancelled: 'neutral' };
const partyName = (p: { title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null } | null) =>
  p ? (p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim()) : null;

export default async function DispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await dispatchDetail(ctx.scope, id);
  if (!d) notFound();
  const canEdit = ctx.permissions.has('complaints.edit');
  const late = (d.status === 'sent' || d.status === 'part_back') && !!d.expectedBackAt && d.expectedBackAt.getTime() < Date.now();
  const facts: [string, ReactNode][] = [
    ['Going to', [d.supplierLabel, d.serviceCentre].filter(Boolean).join(' / ') || '-'],
    ['Supplier RMA no.', d.supplierRmaNo ?? '-'],
    ['Sent', `${day(d.sentAt)}${d.createdByName ? ` by ${d.createdByName}` : ''}`],
    ['Expected back', d.expectedBackAt ? `${day(d.expectedBackAt)}${late ? ' - late' : ''}` : '-'],
    ['Courier', [d.courier, d.docketNo].filter(Boolean).join(' · ') || '-'],
    ['Tracking', d.trackingUrl ? <a href={d.trackingUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-brand hover:underline">Open tracking ↗</a> : '-'],
    ['Courier charge', `${rupees(d.courierChargePaise)} · ${COURIER_PAID_BY_LABEL[d.courierPaidBy as CourierPaidBy] ?? d.courierPaidBy} · shared ${d.chargeSplit === 'value' ? 'by value' : 'equally'}`],
    ['Boxes / weight', `${d.boxes ?? '-'} box${d.boxes === 1 ? '' : 'es'}${d.weightKg ? ` · ${String(d.weightKg)} kg` : ''}`],
  ];
  const btn = 'inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted';
  return (
    <div className="flex flex-col gap-4">
      <DetailHeader icon="truck" kind="Supplier dispatch" number={d.dispatchNo}
        status={{ label: late ? 'Late' : DISPATCH_STATUS_LABEL[d.status as DispatchStatus] ?? d.status, tone: late ? 'danger' : TONE[d.status] ?? 'neutral' }}
        facts={[{ label: 'Going to', value: d.supplierLabel ?? d.serviceCentre }, { label: 'Items', value: String(d.cases.length) }]}
        backHref="/services/dispatch" backLabel="Supplier Dispatch" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}><dt className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="text-sm">{v}</dd></div>
              ))}
            </dl>
            {d.note && <p className="mt-3 text-sm text-muted-foreground">{d.note}</p>}
          </section>
          <BoxItems dispatchId={d.id} canEdit={canEdit} cases={d.cases.map((c) => ({
            id: c.id, caseNo: c.caseNo, status: c.status, productName: c.productName, serialNo: c.serialNo, outcome: c.outcome,
            replacementSerialNo: c.replacementSerialNo, courierSharePaise: c.courierSharePaise, creditNoteNo: c.creditNoteNo, creditAmountPaise: c.creditAmountPaise,
            supplierAnswer: c.supplierAnswer, supplierQuotePaise: c.supplierQuotePaise, supplierAnswerNote: c.supplierAnswerNote,
            closedOn: c.closedOn, supplierReplyRef: c.supplierReplyRef, supplierOnFile: !!c.supplierId, receipt: c.receipt,
            complaint: c.complaint, customerId: c.customerId, customerName: partyName(c.customer),
          }))} />
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-card">
            <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Actions</h2>
            <Link href={`/services/dispatch/${d.id}/challan`} className={btn}>Print delivery challan</Link>
            {d.trackingUrl && <a href={d.trackingUrl} target="_blank" rel="noreferrer noopener" className={btn}>Track the courier ↗</a>}
            <p className="text-xs text-muted-foreground">Record the supplier&apos;s answer and receive what came back from the items list. Each item&apos;s complaint follows by itself.</p>
          </section>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-card">
            <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">RMA receipts ({d.receipts.length})</h2>
            {d.receipts.length === 0 && <p className="text-xs text-muted-foreground">Nothing received yet.</p>}
            {d.receipts.map((r) => (
              <Link key={r.id} href={`/services/dispatch/receipts/${r.id}`} className="flex items-baseline justify-between gap-2 text-sm hover:underline">
                <span className="font-mono text-brand">{r.receiptNo}</span>
                <span className="text-xs text-muted-foreground">{day(r.receivedAt)} · {r._count.cases} item{r._count.cases === 1 ? '' : 's'}</span>
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
