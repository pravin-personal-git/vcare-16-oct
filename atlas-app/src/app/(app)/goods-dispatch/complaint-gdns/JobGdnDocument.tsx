'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { loadJobGdn } from './actions';

/**
 * A job GDN as a printable document — Pravin's point 6.
 *
 * A regular GDN has opened as a proper note since it was built: letterhead,
 * ship-to, the lines, somewhere to sign, a print button. A job GDN — the parts
 * a technician carried to a customer's site — opened as a row in a table and
 * nothing else. Same goods, same warehouse, same signature wanted at the other
 * end, two different standards of paperwork.
 *
 * Deliberately the SAME document, not a new design. It prints the same way, it
 * reads the same way, and somebody who has handled one will not have to learn
 * the other. The three things that genuinely differ are shown and nothing else
 * is invented:
 *
 *   - it goes to a SITE, which is not necessarily the billing address;
 *   - it hangs off a complaint and a job challan rather than a sales order;
 *   - parts can come BACK, so what was returned is on the face of it.
 *
 * Read-only, like its sibling. Issuing, returning and cancelling live on the
 * job where the context is — a print view that can also move stock is a print
 * view somebody will move stock from by accident.
 */

type Gdn = NonNullable<Awaited<ReturnType<typeof loadJobGdn>>>;

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });

export function JobGdnDocument({ id, onClose }: { id: string; onClose: () => void }) {
  const [o, setO] = useState<Gdn | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJobGdn(id).then((d) => { setO(d); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading || !o) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="rounded-lg bg-card px-6 py-4 text-sm shadow-overlay">Loading…</div>
      </div>
    );
  }

  const returned = o.items.reduce((t, i) => t + i.returned, 0);

  return (
    <DialogFrame
      label="Job goods dispatch note"
      onClose={onClose}
      className="thin-scroll fixed inset-0 z-[200] overflow-y-auto bg-navy/40 p-2 print:static print:bg-white print:p-0"
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #job-gdn-doc, #job-gdn-doc * { visibility: visible; }
          #job-gdn-doc { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="mx-auto max-w-3xl">
        <div className="no-print mb-2 overflow-hidden rounded-lg bg-card shadow-raised">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
              <Icon name="truck" className="h-4 w-4" />
            </span>
            <div className="me-auto min-w-0">
              <p className="truncate font-mono text-sm font-bold text-brand">{o.gdnNo}</p>
              <p className="truncate text-xs text-muted-foreground">
                {o.organizationName ?? o.customerName}
              </p>
            </div>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button variant="outline" icon="x" onClick={onClose}>Close</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-2 py-2">
            {o.cancelledAt
              ? <Badge tone="danger">Cancelled</Badge>
              : <Badge tone="brand">Issued</Badge>}
            {returned > 0 && <Badge tone="warning">{returned} returned</Badge>}
            <span className="text-xs text-muted-foreground">
              To issue, return or cancel parts, open the job under Services &amp; Complaints.
            </span>
          </div>
        </div>

        <div id="job-gdn-doc" className="bg-white p-8 text-black shadow">
          <div className="flex items-start justify-between border-b-2 border-black pb-4">
            <div className="flex items-start gap-3">
              {o.org.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
                <img src={o.org.logoUrl} alt={o.org.name} className="h-12 w-12 shrink-0 object-contain" />
              )}
              <div>
                <h1 className="text-xl font-bold">{o.org.name}</h1>
                <p className="text-xs">
                  {o.storeName}{o.storeAddress ? ` · ${o.storeAddress}` : ''}
                </p>
              </div>
            </div>
            <div className="text-end">
              <h2 className="text-lg font-bold">GOODS DISPATCH NOTE</h2>
              <p className="font-mono text-sm">{o.gdnNo}</p>
              <p className="text-xs">Issued: {fmt(o.issuedAt)}</p>
              <p className="text-xs">Against job <Link className="hover:text-brand hover:underline" href={`/services/complaints/${o.complaintId}`}>{o.complaintNo}</Link></p>
            </div>
          </div>

          {o.cancelledAt && (
            <p className="mt-3 border border-black p-2 text-xs font-bold">
              CANCELLED {fmt(o.cancelledAt)}
              {o.cancelReason ? ` — ${o.cancelReason}` : ''}. The parts below were returned to stock.
            </p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-micro font-semibold uppercase">Delivered to site</p>
              <p className="font-medium">{o.organizationName ?? o.customerName}</p>
              {o.organizationName && <p className="text-xs">{o.customerName}</p>}
              {o.siteLabel && <p className="text-xs font-medium">{o.siteLabel}</p>}
              {o.siteAddress && <p className="text-xs">{o.siteAddress}</p>}
              {o.phone && <p className="text-xs">{o.phone}</p>}
            </div>
            <div>
              <p className="text-micro font-semibold uppercase">The job</p>
              <p className="text-xs">Complaint <Link className="hover:text-brand hover:underline" href={`/services/complaints/${o.complaintId}`}>{o.complaintNo}</Link></p>
              <p className="text-xs">Challan <Link className="hover:text-brand hover:underline" href={`/services/complaints/${o.complaintId}#challan-${o.challanId}`}>{o.challanNo}</Link> · {o.challanType}</p>
              {o.issuedByName && <p className="text-xs">Issued by {o.issuedByName}</p>}
            </div>
          </div>

          {o.complaintNote && (
            <p className="mt-3 text-xs">
              <span className="font-semibold">Reported: </span>{o.complaintNote}
            </p>
          )}

          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-xs">
                <th className="py-1.5 text-start">#</th>
                <th className="py-1.5 text-start">Description</th>
                <th className="py-1.5 text-end">Issued</th>
                <th className="py-1.5 text-end">Returned</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.srNo} className="border-b border-gray-300">
                  <td className="py-1.5">{i.srNo}</td>
                  <td className="py-1.5">
                    {i.productName}
                    {i.productCode && (
                      <span className="ms-2 font-mono text-xs">{i.productCode}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{i.qty}</td>
                  <td className="py-1.5 text-end tabular-nums">{i.returned || '—'}</td>
                </tr>
              ))}
              {o.items.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-center text-xs">Nothing was issued on this note.</td></tr>
              )}
            </tbody>
          </table>

          {/*
            The returns column is why this document is not simply the sales GDN
            with different words. Parts go to a site, some get fitted and some
            come back at the end of the job, and a note that cannot show that is
            a note the storeman cannot reconcile against.
          */}
          <p className="mt-2 text-xs">
            Parts not fitted must be returned to the branch. Returns are recorded against this note.
          </p>

          <div className="mt-12 flex justify-between text-xs">
            <div>
              <div className="w-48 border-t border-black pt-1">Issued by</div>
              {o.issuedByName && <p className="mt-1">{o.issuedByName}</p>}
            </div>
            <div>
              <div className="w-48 border-t border-black pt-1">Received at site</div>
              <p className="mt-1">Name, signature and date</p>
            </div>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
