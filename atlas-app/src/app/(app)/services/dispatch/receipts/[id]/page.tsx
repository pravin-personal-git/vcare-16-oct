import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { receiptDetail } from '@/server/rma-receipt';
import { PrintButton } from '@/components/services/PrintButton';
import { RMA_OUTCOME_LABEL, type RmaOutcome } from '@/lib/rma';
import { COURIER_PAID_BY_LABEL, type CourierPaidBy } from '@/lib/supplier-dispatch';

/**
 * RMA RECEIPT (10 Oct 2026, repair flow stage 5). What came back from a
 * supplier, line by line: repaired, a new serial, or back unrepaired. Not a
 * purchase GRN - a customer's item is theirs, and nothing here is our stock -
 * so it has its own series (GRR) and never touches purchase reports. Each line
 * links to its case and its complaint; the receipt links to the box it went in.
 */
const day = (x: Date | null) => (x ? x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function RmaReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const r = await receiptDetail(ctx.scope, id);
  if (!r) notFound();
  const cell = 'border border-gray-400 px-2 py-1';
  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">
      <div className="mb-4 flex flex-wrap justify-between gap-2 print:hidden">
        {r.dispatch ? <Link href={`/services/dispatch/${r.dispatch.id}`} className="text-sm font-medium text-brand hover:underline">← {r.dispatch.dispatchNo}</Link> : <span />}
        <PrintButton />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">{r.store.organization.name}</h1>
          <p className="text-xs">{r.store.name}{r.store.address ? ` · ${r.store.address}` : ''}</p>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">RMA RECEIPT</h2>
          <p className="text-xs font-semibold">Back from the supplier - for repair, not a purchase</p>
          <p className="font-mono text-sm">{r.receiptNo}</p>
          <p className="text-xs">{day(r.receivedAt)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase">From</p>
          <p className="font-semibold">{r.supplierLabel ?? '-'}</p>
        </div>
        <div className="text-xs">
          {r.dispatch && <p>Sent on: <span className="font-mono">{r.dispatch.dispatchNo}</span>{r.dispatch.docketNo ? ` · docket ${r.dispatch.docketNo}` : ''}</p>}
          {r.dispatch?.supplierRmaNo && <p>Supplier RMA no.: <span className="font-mono">{r.dispatch.supplierRmaNo}</span></p>}
          {(r.courier || r.docketNo) && <p>Return courier: {[r.courier, r.docketNo].filter(Boolean).join(' · ')}</p>}
          {r.courierChargePaise > 0 && <p>Return charge: {rupees(r.courierChargePaise)} · {COURIER_PAID_BY_LABEL[r.courierPaidBy as CourierPaidBy] ?? r.courierPaidBy}</p>}
          {r.createdByName && <p>Received by: {r.createdByName}</p>}
        </div>
      </div>
      <table className="mt-4 w-full border border-gray-400 text-sm">
        <thead><tr className="bg-gray-100">
          <th className={`${cell} text-start`}>#</th><th className={`${cell} text-start`}>Item</th><th className={`${cell} text-start`}>Sent as</th>
          <th className={`${cell} text-start`}>Came back</th><th className={`${cell} text-start`}>Case · complaint</th>
        </tr></thead>
        <tbody>
          {r.cases.map((c, n) => (
            <tr key={c.id}>
              <td className={cell}>{n + 1}</td>
              <td className={cell}>{c.productName}{c.brandModel && c.brandModel !== c.productName ? ` (${c.brandModel})` : ''}{c.customerName ? <span className="block text-xs">{c.customerName}</span> : null}</td>
              <td className={`${cell} font-mono`}>{c.serialNo ?? '-'}</td>
              <td className={cell}>{RMA_OUTCOME_LABEL[c.outcome as RmaOutcome] ?? c.outcome ?? '-'}{c.replacementSerialNo ? <span className="block font-mono text-xs">New S/N {c.replacementSerialNo}</span> : null}</td>
              <td className={`${cell} text-xs`}>
                <Link href={`/services/replacements?q=${encodeURIComponent(c.caseNo)}&open=${c.id}`} className="font-mono hover:underline">{c.caseNo}</Link>
                {c.complaint && <Link href={`/services/complaints/${c.complaint.id}`} className="block font-mono hover:underline">{c.complaint.complaintNo}</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.note && <p className="mt-3 text-sm">{r.note}</p>}
      <p className="mt-4 text-xs">A customer&apos;s item received here remains the customer&apos;s and is handed back on the complaint it came from. Not added to stock.</p>
      <div className="mt-12 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">Delivered by (supplier / courier)</div>
        <div className="border-t border-black pt-1">Received for {r.store.organization.name}</div>
      </div>
    </article>
  );
}
