'use client';

import { ProductLink } from '@/components/document/ProductLink';
import { useEffect, useState } from 'react';
import { FULFILMENT_LABEL, type FulfilmentStatus } from '@/lib/sales-order-status';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { loadDispatch } from './actions';
import { DialogFrame } from '@/components/ui/DialogFrame';

interface GdnVM {
  id: string;
  orderNo: string;
  fulfilmentStatus: FulfilmentStatus;
  stageLabel?: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  customerName: string;
  organizationName: string | null;
  phone: string;
  shippingAddress: string | null;
  billingAddress: string | null;
  cityId: string | null;
  stateId: string | null;
  courierName: string | null;
  deliveryMode: string | null;
  awbNo: string | null;
  items: { srNo: number; productId?: string | null; productName: string; productCode: string | null; qty: number }[];
  storeName: string;
  storeAddress: string | null;
  org: { name: string; logoUrl: string | null };
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** Read-only print view. No status controls here - those live on the sales order itself. */
export function GdnDocument({ id, onClose }: { id: string; onClose: () => void }) {
  const [o, setO] = useState<GdnVM | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDispatch(id).then((d) => { setO(d as GdnVM | null); setLoading(false); });
  }, [id]);

  if (loading || !o) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="rounded-lg bg-card px-6 py-4 text-sm shadow-overlay">Loading…</div>
      </div>
    );
  }

  const shipTo = o.shippingAddress ?? o.billingAddress;

  return (
    <DialogFrame label="Goods dispatch note" onClose={onClose} className="thin-scroll fixed inset-0 z-[200] overflow-y-auto bg-navy/40 p-2 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #gdn-doc, #gdn-doc * { visibility: visible; }
          #gdn-doc { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
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
              <p className="truncate font-mono text-sm font-bold text-brand">{o.orderNo}</p>
              <p className="truncate text-xs text-muted-foreground">{o.customerName}</p>
            </div>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button variant="outline" icon="x" onClick={onClose}>Close</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-2 py-2">
            <Badge tone={o.fulfilmentStatus === 'delivered' ? 'success' : 'brand'}>
              {o.stageLabel ?? FULFILMENT_LABEL[o.fulfilmentStatus]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              To change the status or AWB, open this order under Sales Orders.
            </span>
          </div>
        </div>

        <div id="gdn-doc" className="bg-white p-8 text-black shadow">
          <div className="flex items-start justify-between border-b-2 border-black pb-4">
            <div className="flex items-start gap-3">
              {o.org.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
                <img src={o.org.logoUrl} alt={o.org.name} className="h-12 w-12 shrink-0 object-contain" />
              )}
              <div>
                <h1 className="text-xl font-bold">{o.org.name}</h1>
                <p className="text-xs">{o.storeName}{o.storeAddress ? ` · ${o.storeAddress}` : ''}</p>
              </div>
            </div>
            <div className="text-end">
              <h2 className="text-lg font-bold">GOODS DISPATCH NOTE</h2>
              <p className="font-mono text-sm">Against {o.orderNo}</p>
              <p className="text-xs">Order date: {fmt(o.orderDate)}</p>
              {o.expectedDeliveryDate && <p className="text-xs">Expected: {fmt(o.expectedDeliveryDate)}</p>}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-micro font-semibold uppercase">Ship to</p>
              <p className="font-medium">{o.organizationName ?? o.customerName}</p>
              {o.organizationName && <p className="text-xs">{o.customerName}</p>}
              {shipTo && <p className="text-xs">{shipTo}</p>}
              <p className="text-xs">{[o.cityId, o.stateId].filter(Boolean).join(', ')}</p>
              <p className="text-xs">{o.phone}</p>
            </div>
            <div>
              <p className="text-micro font-semibold uppercase">Courier</p>
              <p className="text-xs">{o.courierName ?? 'Not set'}{o.deliveryMode ? ` · ${o.deliveryMode}` : ''}</p>
              {o.awbNo && <p className="text-xs">AWB / Docket: {o.awbNo}</p>}
            </div>
          </div>

          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-xs">
                <th className="py-1.5 text-start">#</th>
                <th className="py-1.5 text-start">Description</th>
                <th className="py-1.5 text-end">Qty</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.srNo} className="border-b border-gray-300">
                  <td className="py-1.5 text-xs">{i.srNo}</td>
                  <td className="py-1.5">
                    <p className="text-xs font-medium"><ProductLink id={i.productId}>{i.productName}</ProductLink></p>
                    {i.productCode && <p className="font-mono text-xs text-gray-600">{i.productCode}</p>}
                  </td>
                  <td className="py-1.5 text-end text-xs">{i.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-10 flex items-end justify-between text-xs">
            <span>Received in good condition - signature &amp; date</span>
            <span>For {o.org.name}</span>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
