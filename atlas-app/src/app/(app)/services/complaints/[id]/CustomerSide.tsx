'use client';

import { useRouter } from 'next/navigation';
import { docMessage } from '@/lib/wa-message';
import { whatsappLink } from '@/lib/revenue';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ProductFinder, type FindableProduct } from '@/components/document/ProductFinder';
import Link from 'next/link';
import { billJobAction, customerLinkAction, sendEstimateAction, setJobBillAction, waiveBillingAction } from '../../actions';
import type { BillLine } from '@/lib/job-bill';

/**
 * The customer side of a job, from the office (workflow slice 5): send the
 * customer their no-login link (copy or WhatsApp), send an estimate for
 * chargeable work, and see what the customer did - estimate waiting, rating.
 */
/** A part line carries its product (so the estimate follows returns) and GST rate (28 Sep 2026). */
export interface EstimateSeedLine { description: string; qty: number; unitPaise: number; productId?: string | null; taxRatePct?: number }

export function CustomerSide({ complaintId, complaintNo, canEdit, canEstimate, seed, waitingEstimatePaise, rating, catalogue = [], invoice = null, billingStatus = 'not_billable', canBill = false, finished = false, bill = null }: {
  /** What Bill this job would put on the invoice (stage 7): from the switches, or the approved estimate. */
  bill?: { lines: BillLine[]; basePaise: number; withGstPaise: number; fromEstimate: boolean; fromOffice?: boolean } | null;
  complaintId: string; complaintNo: string; canEdit: boolean; canEstimate: boolean;
  /** Bill this job: the job's invoice, where billing stands, and whether this person may bill. */
  invoice?: { id: string; invoiceNo: string; lifecycle: string } | null; billingStatus?: string; canBill?: boolean; finished?: boolean;
  /** Products for the estimate's search box (the same finder as quotations). */
  catalogue?: FindableProduct[];
  seed: EstimateSeedLine[]; waitingEstimatePaise: number | null; rating: { stars: number; techStars: number | null; comment: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<{ url: string; phone: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [billing, setBilling] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [waiveWhy, setWaiveWhy] = useState('');
  const chargeable = !invoice && billingStatus !== 'waived' && !!bill && bill.lines.length > 0;

  const getLink = () => start(async () => {
    setError(null);
    const r = await customerLinkAction(complaintId);
    if (r.error || !r.url) { setError(r.error ?? 'Could not make the link.'); return; }
    setLink({ url: r.url, phone: r.phone ?? null });
  });
  const wa = (url: string, phone: string | null) => {
    // One wording and the +91 rule for every document (A1, 11 Oct 2026).
    return whatsappLink(phone, docMessage({ kind: 'complaint', number: complaintNo, note: 'See progress, confirm when it is fixed, and rate us here:', url }));
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Customer</h2>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {waitingEstimatePaise !== null && (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">Estimate of <strong>₹{(waitingEstimatePaise / 100).toLocaleString('en-IN')}</strong> is waiting for the customer to approve.</p>
      )}
      {rating && (
        <p className="mt-2 text-sm">
          Work <span className="text-warning">{'★'.repeat(rating.stars)}</span><span className="text-muted-foreground">{'★'.repeat(5 - rating.stars)}</span>
          {rating.techStars ? <> · Technician <span className="text-warning">{'★'.repeat(rating.techStars)}</span><span className="text-muted-foreground">{'★'.repeat(5 - rating.techStars)}</span></> : null}
          {rating.comment ? ` - ${rating.comment}` : ''}
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" icon="send" loading={pending && !link} onClick={getLink}>Customer link</Button>
          {canEstimate && <Button size="sm" icon="receipt" onClick={() => setEstimating(true)}>Send estimate</Button>}
          {/* Nothing to bill yet: the office can still charge the visit (25 Oct 2026). */}
          {!invoice && canBill && !chargeable && <Button size="sm" icon="plus" onClick={() => { setError(null); setBilling(true); }}>Add a charge</Button>}
          {canBill && chargeable && (billingStatus === 'to_invoice' || finished) && (
            <Button size="sm" onClick={() => { setError(null); setWaiving(true); }}>Don&apos;t bill</Button>
          )}
          {!invoice && canBill && chargeable && (billingStatus === 'to_invoice' || finished) && (
            <Button size="sm" variant="primary" icon="file-text" loading={pending} onClick={() => start(async () => {
              setError(null);
              const r = await billJobAction(complaintId);
              if (r.error || !r.invoiceId) { setError(r.error ?? 'Could not bill the job.'); return; }
              router.push(`/invoices/${r.invoiceId}`);
            })}>Bill this job</Button>
          )}
        </div>
      )}
      {invoice && (
        <p className="mt-2 text-sm">Billed on <Link href={`/invoices/${invoice.id}`} className="font-mono font-medium text-brand hover:underline">{invoice.invoiceNo}</Link> <span className="text-muted-foreground">({invoice.lifecycle === 'draft' ? 'draft - issue it to post it to accounts' : invoice.lifecycle})</span></p>
      )}
      {!invoice && billingStatus === 'to_invoice' && <p className="mt-2 text-xs text-muted-foreground">{bill?.fromOffice ? 'Charges set by the office' : 'Estimate approved'} - ready to bill (parts at the quantity actually used).</p>}
      {chargeable && bill && (
        <div className="mt-3 rounded-lg border border-border px-3 py-2">
          <p className="flex items-baseline justify-between gap-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{bill.fromOffice ? 'To bill - set by the office' : bill.fromEstimate ? 'To bill - the approved estimate' : 'To bill - from the switches'}</span>
            {canBill && <button type="button" className="text-xs font-medium normal-case tracking-normal text-brand hover:underline" onClick={() => { setError(null); setBilling(true); }}>Change</button>}
          </p>
          <ul className="mt-1 divide-y divide-border text-sm">
            {bill.lines.map((l, n) => (
              <li key={n} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0">{l.description}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
                <span className="shrink-0 tabular-nums">₹{((l.qty * l.unitPaise) / 100).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between border-t border-border pt-1 text-sm font-semibold"><span>Total with GST</span><span className="tabular-nums">₹{(bill.withGstPaise / 100).toLocaleString('en-IN')}</span></p>
          {!finished && <p className="mt-1 text-xs text-muted-foreground">Billed once the job is done. It cannot close until this is billed, or you choose Don&apos;t bill.</p>}
        </div>
      )}
      {!invoice && billingStatus === 'waived' && <p className="mt-2 text-xs text-muted-foreground">Not billed - the reason is in the activity log.</p>}
      {waiving && (
        <Modal title="Don't bill this job" icon="ban" size="sm" onClose={() => setWaiving(false)}
          footer={<><Button onClick={() => setWaiving(false)}>Cancel</Button><Button variant="primary" loading={pending} disabled={!waiveWhy.trim()} onClick={() => start(async () => {
            const r = await waiveBillingAction(complaintId, waiveWhy);
            if (r.error) { setError(r.error); return; }
            setWaiving(false); router.refresh();
          })}>Don&apos;t bill</Button></>}>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Why is it not charged? (kept on the job)
            <input id="waive-why" value={waiveWhy} onChange={(e) => setWaiveWhy(e.target.value)} placeholder="Goodwill - repeat failure within a week" className="field-input" />
          </label>
        </Modal>
      )}
      {link && (
        <div className="mt-3 grid gap-2">
          <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{link.url}</p>
          <p className="text-xs text-muted-foreground">No login needed - the customer sees progress, confirms when it is fixed, approves estimates and rates. It opens only this job.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(link.url).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Copied' : 'Copy link'}</Button>
            {link.phone && <a href={wa(link.url, link.phone)} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">Send on WhatsApp</a>}
          </div>
        </div>
      )}
      {estimating && (
        <EstimateDialog seed={seed} catalogue={catalogue} busy={pending} onClose={() => setEstimating(false)}
          onSend={(lines, note) => start(async () => {
            setError(null);
            const r = await sendEstimateAction(complaintId, lines, note);
            if (r.error) setError(r.error); else setEstimating(false);
            router.refresh();
          })} />
      )}
      {billing && (
        <EstimateDialog mode="bill" seed={chargeable && bill ? bill.lines : [{ description: 'Service charge', qty: 1, unitPaise: 0, taxRatePct: 18 }]}
          catalogue={catalogue} busy={pending} onClose={() => setBilling(false)}
          onSend={(lines) => start(async () => {
            setError(null);
            const r = await setJobBillAction(complaintId, lines);
            if (r.error) setError(r.error); else setBilling(false);
            router.refresh();
          })} />
      )}
    </section>
  );
}

/**
 * `mode="bill"` (25 Oct 2026, Vcare): the same lines, but the office sets the
 * job's charges itself - no customer approval, no note to the customer.
 */
function EstimateDialog({ mode = 'estimate', seed, catalogue, busy, onClose, onSend }: {
  mode?: 'estimate' | 'bill';
  seed: EstimateSeedLine[]; catalogue: FindableProduct[]; busy: boolean; onClose: () => void; onSend: (lines: EstimateSeedLine[], note: string | null) => void;
}) {
  const asBill = mode === 'bill';
  // Products come from the search box (like quotations) at the selling price
  // (DLP); labour, visit and other costs are free-text lines. Every line has
  // its GST, so the customer approves what they will be billed (28 Sep 2026).
  type Row = { description: string; qty: string; rupees: string; gst: string; productId: string | null };
  const [lines, setLines] = useState<Row[]>(
    seed.map((l) => ({ description: l.description, qty: String(l.qty), rupees: String(asBill ? l.unitPaise / 100 : Math.round(l.unitPaise / 100)), gst: String(l.taxRatePct ?? 18), productId: l.productId ?? null })),
  );
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const net = (l: Row) => (Number(l.qty) || 0) * (Number(l.rupees) || 0);
  const subtotal = lines.reduce((s, l) => s + net(l), 0);
  const gst = lines.reduce((s, l) => s + (net(l) * (Number(l.gst) || 0)) / 100, 0);
  const total = Math.round((subtotal + gst) * 100) / 100;
  const set = (i: number, patch: Partial<Row>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addProduct = () => {
    const p = catalogue.find((x) => x.id === pick);
    if (!p) return;
    const rate = (p as FindableProduct & { taxRatePct?: number }).taxRatePct ?? 18;
    setLines([...lines, { description: p.name, qty: '1', rupees: String(Math.round(p.dlpPaise / 100)), gst: String(rate), productId: p.id }]);
    setPick('');
  };
  return (
    <Modal title={asBill ? 'Change the bill' : 'Send estimate to the customer'} icon="receipt" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!lines.some((l) => l.description.trim() && (!asBill || net(l) > 0))}
        onClick={() => onSend(lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unitPaise: Math.round((Number(l.rupees) || 0) * 100), productId: l.productId, taxRatePct: Number(l.gst) || 0 })), note.trim() || null)}>
        {asBill ? 'Save bill' : 'Send'} (₹{total.toLocaleString('en-IN')} incl. GST)</Button></>}>
      <div className="grid gap-3">
        <p className="text-xs text-muted-foreground">{asBill
          ? 'Add a service charge, change a price or take a line off. Bill this job then uses these lines, without asking the customer. A line at ₹0 is left off; if parts come back later, a part line drops to what was used.'
          : 'Prefilled from the visit charge and the parts on this job\'s challans at the selling price, quantity = what was used. Change anything. The job waits until the customer approves; if parts come back later, a waiting estimate drops to what was used.'}</p>
        {catalogue.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium">Add a product</p>
            <ProductFinder products={catalogue} pickedId={pick} onPick={setPick} />
            <div><Button size="sm" icon="plus" disabled={!pick} onClick={addProduct}>Add product</Button></div>
          </div>
        )}
        {lines.length > 0 && (
          <div className="grid gap-2">
            <div className="flex gap-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
              <span className="min-w-40 flex-1">Item</span><span className="w-16">Qty</span><span className="w-24">Price each (₹)</span><span className="w-16">GST %</span><span className="w-14" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label="Item" value={l.description} onChange={(e) => set(i, { description: e.target.value })}
                  placeholder={l.productId ? 'Product' : 'Labour, visit charge, transport…'} className="field-input min-w-40 flex-1" />
                <input aria-label="Quantity" type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="field-input w-16" />
                <input aria-label="Price each (₹)" type="number" min={0} value={l.rupees} onChange={(e) => set(i, { rupees: e.target.value })} className="field-input w-24" />
                <select aria-label="GST %" value={l.gst} onChange={(e) => set(i, { gst: e.target.value })} className="field-input w-16">
                  {['0', '5', '12', '18', '28'].map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <button type="button" className="w-14 text-xs text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <p className="text-end text-xs tabular-nums text-muted-foreground">Subtotal ₹{subtotal.toLocaleString('en-IN')} · GST ₹{(Math.round(gst * 100) / 100).toLocaleString('en-IN')} · <strong className="text-foreground">Total ₹{total.toLocaleString('en-IN')}</strong></p>
          </div>
        )}
        <div><Button size="sm" icon="plus" onClick={() => setLines([...lines, { description: asBill ? (lines.some((l) => l.description === 'Service charge') ? '' : 'Service charge') : lines.some((l) => l.description === 'Labour') ? '' : 'Labour', qty: '1', rupees: '0', gst: '18', productId: null }])}>{asBill ? 'Add a charge' : 'Add labour / other cost'}</Button></div>
        {!asBill && <textarea aria-label="Note to the customer" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the customer (optional)" className="field-input" />}
      </div>
    </Modal>
  );
}
