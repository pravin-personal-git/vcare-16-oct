import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { PrintButton } from '@/components/services/PrintButton';

/**
 * PICKUP RECEIPT (10 Oct 2026, repair flow stage 3) - the paper the customer
 * signs when their own items leave the site for repair. Printed or shared,
 * it answers "did you ever take my camera?" months later.
 */
const d = (x: Date) => x.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default async function PickupReceiptPage({ params }: { params: Promise<{ id: string; pickupId: string }> }) {
  const { id, pickupId } = await params;
  const ctx = await requireContext();
  const p = await db.itemPickup.findFirst({
    where: { id: pickupId, complaintId: id, ...scopeWhere(ctx.scope) },
    select: {
      pickupNo: true, pickedUpAt: true, pickedUpBy: true, handedOverBy: true, note: true,
      store: { select: { name: true, address: true, organization: { select: { name: true } } } },
      complaint: { select: { complaintNo: true, siteLocation: true, customer: { select: { companyName: true, firstName: true, lastName: true, phone: true } } } },
      items: { orderBy: { srNo: 'asc' }, select: { id: true, equipmentName: true, serialNo: true, ours: true, problem: true } },
    },
  });
  if (!p) notFound();
  const staff = p.pickedUpBy ? await db.user.findUnique({ where: { id: p.pickedUpBy }, select: { fullName: true } }) : null;
  const cu = p.complaint.customer;
  const customer = cu.companyName || [cu.firstName, cu.lastName].filter(Boolean).join(' ');
  const row = 'border-b border-gray-300 py-1.5';
  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">{p.store.organization.name}</h1>
          <p className="text-xs">{p.store.name}{p.store.address ? ` · ${p.store.address}` : ''}</p>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">PICKUP RECEIPT</h2>
          <p className="font-mono text-sm">{p.pickupNo}</p>
          <p className="text-xs">Complaint {p.complaint.complaintNo}</p>
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <tbody>
          <tr><td className={`${row} w-44 font-semibold`}>Customer</td><td className={row}>{customer} · {cu.phone}</td></tr>
          {p.complaint.siteLocation && <tr><td className={`${row} font-semibold`}>Site</td><td className={row}>{p.complaint.siteLocation}</td></tr>}
          <tr><td className={`${row} font-semibold`}>Taken on</td><td className={row}>{d(p.pickedUpAt)}</td></tr>
          <tr><td className={`${row} font-semibold`}>Taken by</td><td className={row}>{staff?.fullName ?? '-'}</td></tr>
          <tr><td className={`${row} font-semibold`}>Handed over by</td><td className={row}>{p.handedOverBy ?? '-'}</td></tr>
          {p.note && <tr><td className={`${row} font-semibold`}>Note</td><td className={row}>{p.note}</td></tr>}
        </tbody>
      </table>
      <h3 className="mt-6 text-sm font-bold">Items taken for repair</h3>
      <table className="mt-2 w-full border border-gray-400 text-sm">
        <thead><tr className="bg-gray-100"><th className="border border-gray-400 px-2 py-1 text-start">#</th><th className="border border-gray-400 px-2 py-1 text-start">Item</th><th className="border border-gray-400 px-2 py-1 text-start">Serial</th></tr></thead>
        <tbody>
          {p.items.map((i, n) => (
            <tr key={i.id}>
              <td className="border border-gray-400 px-2 py-1">{n + 1}</td>
              <td className="border border-gray-400 px-2 py-1">{i.equipmentName}{i.ours ? '' : ' (not sold by us)'}{i.problem ? ` - ${i.problem}` : ''}</td>
              <td className="border border-gray-400 px-2 py-1 font-mono">{i.serialNo ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs">These items remain the customer&apos;s property. They are taken for repair or for the supplier&apos;s warranty, and will be returned on this complaint.</p>
      <div className="mt-12 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">Customer&apos;s signature</div>
        <div className="border-t border-black pt-1">For {p.store.organization.name}</div>
      </div>
    </article>
  );
}
