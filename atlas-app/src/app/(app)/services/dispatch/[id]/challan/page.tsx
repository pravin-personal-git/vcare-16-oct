import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { dispatchDetail } from '@/server/supplier-dispatch';
import { PrintButton } from '@/components/services/PrintButton';

/**
 * DELIVERY CHALLAN FOR REPAIR (10 Oct 2026, repair flow stage 4). Goods sent
 * to a supplier or service centre for repair or warranty replacement are not
 * a sale: they travel on a delivery challan with their value stated and no
 * tax charged, and come back. This is that paper for one supplier dispatch.
 */
const day = (x: Date | null) => (x ? x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function DeliveryChallanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await dispatchDetail(ctx.scope, id);
  if (!d) notFound();
  const s = d.supplier;
  const total = d.cases.reduce((a, c) => a + (c.stockUnit?.unitCostPaise ?? 0) * c.qty, 0);
  const cell = 'border border-gray-400 px-2 py-1';
  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">{d.store.organization.name}</h1>
          <p className="text-xs">{d.store.name}{d.store.address ? ` · ${d.store.address}` : ''}</p>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">DELIVERY CHALLAN</h2>
          <p className="text-xs font-semibold">For repair / warranty - not a sale</p>
          <p className="font-mono text-sm">{d.dispatchNo}</p>
          <p className="text-xs">{day(d.sentAt)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase">To</p>
          <p className="font-semibold">{d.supplierLabel ?? d.serviceCentre ?? '-'}</p>
          {d.serviceCentre && d.supplierLabel && <p>{d.serviceCentre}</p>}
          {s && <p className="text-xs">{[s.addressLine1, s.city, s.state].filter(Boolean).join(', ')}{s.gstin ? ` · GSTIN ${s.gstin}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>}
        </div>
        <div className="text-xs">
          {d.supplierRmaNo && <p>Supplier RMA no.: <span className="font-mono">{d.supplierRmaNo}</span></p>}
          {(d.courier || d.docketNo) && <p>Courier: {[d.courier, d.docketNo].filter(Boolean).join(' · ')}</p>}
          {d.boxes ? <p>Boxes: {d.boxes}{d.weightKg ? ` · ${String(d.weightKg)} kg` : ''}</p> : null}
          {d.expectedBackAt && <p>Expected back by: {day(d.expectedBackAt)}</p>}
        </div>
      </div>
      <table className="mt-4 w-full border border-gray-400 text-sm">
        <thead><tr className="bg-gray-100"><th className={`${cell} text-start`}>#</th><th className={`${cell} text-start`}>Item</th><th className={`${cell} text-start`}>Serial</th><th className={`${cell} text-start`}>Our ref.</th><th className={`${cell} text-end`}>Qty</th><th className={`${cell} text-end`}>Value</th></tr></thead>
        <tbody>
          {d.cases.map((c, n) => (
            <tr key={c.id}>
              <td className={cell}>{n + 1}</td>
              <td className={cell}>{c.productName}{c.brandModel && c.brandModel !== c.productName ? ` (${c.brandModel})` : ''}</td>
              <td className={`${cell} font-mono`}>{c.serialNo ?? '-'}</td>
              <td className={`${cell} font-mono`}>{c.caseNo}</td>
              <td className={`${cell} text-end`}>{c.qty}</td>
              <td className={`${cell} text-end`}>{c.stockUnit?.unitCostPaise ? rupees(c.stockUnit.unitCostPaise * c.qty) : '-'}</td>
            </tr>
          ))}
          <tr><td className={`${cell} font-semibold`} colSpan={5}>Total value (for transport only - no tax charged)</td><td className={`${cell} text-end font-semibold`}>{total ? rupees(total) : '-'}</td></tr>
        </tbody>
      </table>
      <p className="mt-4 text-xs">Sent for repair or warranty replacement and to be returned. Not a sale; no tax is charged on this challan.</p>
      <div className="mt-12 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">Received by (supplier / courier)</div>
        <div className="border-t border-black pt-1">For {d.store.organization.name}</div>
      </div>
    </article>
  );
}
