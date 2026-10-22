import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { PrintButton } from '@/components/services/PrintButton';

/**
 * HAND-BACK GDN (10 Oct 2026, repair flow stage 6) - the paper the customer
 * signs when their items come back on the complaint they were taken on: their
 * own unit repaired, the supplier's new serial, or a unit from our stock in
 * place of one the supplier kept. The pickup receipt's other half.
 */
const d = (x: Date) => x.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default async function HandBackPage({ params }: { params: Promise<{ id: string; issueId: string }> }) {
  const { id, issueId } = await params;
  const ctx = await requireContext();
  const mi = await db.materialIssue.findFirst({
    where: { id: issueId, ...scopeWhere(ctx.scope), challan: { complaintId: id, type: 'handback' } },
    select: {
      gdnNo: true, issuedAt: true, issuedBy: true,
      challan: {
        select: {
          note: true,
          lines: { select: { id: true, stockUnitIds: true, product: { select: { productName: true } } } },
          complaint: {
            select: {
              id: true, complaintNo: true, siteLocation: true,
              customer: { select: { companyName: true, firstName: true, lastName: true, phone: true } },
              store: { select: { name: true, address: true, organization: { select: { name: true } } } },
            },
          },
        },
      },
      handedBack: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, equipmentName: true, serialNo: true, status: true,
          replacementCases: { where: { deletedAt: null, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { outcome: true, replacementSerialNo: true, closedOn: true } },
        },
      },
    },
  });
  // A hand-back is always a complaint's (an installation's challan carries material, R3).
  if (!mi || !mi.challan.complaint) notFound();
  const job = mi.challan.complaint;
  const staff = mi.issuedBy ? await db.user.findUnique({ where: { id: mi.issuedBy }, select: { fullName: true } }) : null;
  // What went out of our stock in place of kept items: by serial when it has one, else by product.
  const stockIds = mi.challan.lines.flatMap((l) => l.stockUnitIds);
  const serialOf = new Map((stockIds.length ? await db.stockUnit.findMany({ where: { id: { in: stockIds } }, select: { id: true, serialNo: true } }) : []).map((u) => [u.id, u.serialNo]));
  const stockSerials = mi.challan.lines.flatMap((l) => (l.stockUnitIds.length
    ? l.stockUnitIds.map((u) => ({ product: { productName: l.product.productName }, serialNo: serialOf.get(u) ?? null }))
    : [{ product: { productName: l.product.productName }, serialNo: null }]));
  const cu = job.customer;
  const customer = cu.companyName || [cu.firstName, cu.lastName].filter(Boolean).join(' ');
  const cell = 'border border-gray-400 px-2 py-1';
  const row = 'border-b border-gray-300 py-1.5';
  // What the customer actually takes for each item.
  const lines = mi.handedBack.map((i) => {
    const c = i.replacementCases[0];
    if (c?.outcome === 'replaced') return { item: i.equipmentName, was: i.serialNo, gets: c.replacementSerialNo, how: 'New unit from the supplier - full warranty from today' };
    if (c?.closedOn) return { item: i.equipmentName, was: i.serialNo, gets: null, how: 'Supplier kept it - replaced from our stock (below), full warranty from today' };
    if (c?.outcome === 'returned_unrepaired') return { item: i.equipmentName, was: i.serialNo, gets: i.serialNo, how: 'Returned not repaired' };
    return { item: i.equipmentName, was: i.serialNo, gets: i.serialNo, how: 'Repaired - same unit' };
  });
  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">
      <div className="mb-4 flex flex-wrap justify-between gap-2 print:hidden">
        <Link href={`/services/complaints/${job.id}`} className="text-sm font-medium text-brand hover:underline">← {job.complaintNo}</Link>
        <PrintButton />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">{job.store.organization.name}</h1>
          <p className="text-xs">{job.store.name}{job.store.address ? ` · ${job.store.address}` : ''}</p>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">GOODS DISPATCH NOTE</h2>
          <p className="text-xs font-semibold">Items handed back after repair</p>
          <p className="font-mono text-sm">{mi.gdnNo}</p>
          <p className="text-xs">Complaint {job.complaintNo}</p>
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <tbody>
          <tr><td className={`${row} w-44 font-semibold`}>Customer</td><td className={row}>{customer} · {cu.phone}</td></tr>
          {job.siteLocation && <tr><td className={`${row} font-semibold`}>Site</td><td className={row}>{job.siteLocation}</td></tr>}
          <tr><td className={`${row} font-semibold`}>Handed back on</td><td className={row}>{d(mi.issuedAt)}</td></tr>
          <tr><td className={`${row} font-semibold`}>By</td><td className={row}>{staff?.fullName ?? '-'}</td></tr>
          {mi.challan.note && <tr><td className={`${row} font-semibold`}>Note</td><td className={row}>{mi.challan.note}</td></tr>}
        </tbody>
      </table>
      <table className="mt-4 w-full border border-gray-400 text-sm">
        <thead><tr className="bg-gray-100">
          <th className={`${cell} text-start`}>#</th><th className={`${cell} text-start`}>Item</th><th className={`${cell} text-start`}>Taken as</th>
          <th className={`${cell} text-start`}>Handed back</th><th className={`${cell} text-start`}>What was done</th>
        </tr></thead>
        <tbody>
          {lines.map((l, n) => (
            <tr key={n}>
              <td className={cell}>{n + 1}</td><td className={cell}>{l.item}</td>
              <td className={`${cell} font-mono`}>{l.was ?? '-'}</td><td className={`${cell} font-mono`}>{l.gets ?? '-'}</td><td className={cell}>{l.how}</td>
            </tr>
          ))}
          {stockSerials.map((u, n) => (
            <tr key={`s${n}`}>
              <td className={cell}>{lines.length + n + 1}</td><td className={cell}>{u.product.productName}</td><td className={cell}>-</td>
              <td className={`${cell} font-mono`}>{u.serialNo ?? '-'}</td><td className={cell}>From our stock, in place of an item the supplier kept</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs">Received the above in good condition. A new unit&apos;s warranty runs in full from the date above.</p>
      <div className="mt-12 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">Customer&apos;s signature</div>
        <div className="border-t border-black pt-1">For {job.store.organization.name}</div>
      </div>
    </article>
  );
}
