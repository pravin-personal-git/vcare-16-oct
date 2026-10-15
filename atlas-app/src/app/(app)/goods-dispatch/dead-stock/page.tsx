import Link from 'next/link';
import { requireContext } from '@/server/context';
import { deadStock, type DeadStockRow } from '@/server/rma';
import { Card, PageHeader, SectionCard } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';

/**
 * Inventory > Dead stock & scrap (Pravin, 28 Sep 2026): old units from job
 * replacements still waiting for a decision (send to the supplier, or scrap),
 * and everything scrapped - with what it cost us. Nothing here is sellable
 * stock. The decisions themselves are made on the Replacements case.
 */
export default async function DeadStockPage() {
  const ctx = await requireContext();
  const { waiting, scrapped } = await deadStock(ctx.scope);
  const sum = (rows: DeadStockRow[]) => rows.reduce((s, r) => s + r.valuePaise, 0);
  const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

  const list = (rows: DeadStockRow[], empty: string) => rows.length === 0
    ? <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
    : (
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0">
            <span className="min-w-0 flex-1">
              <Link href={`/services/replacements?open=${r.id}`} className="font-mono font-semibold text-brand hover:underline">{r.caseNo}</Link>
              {' · '}<strong>{r.productName}</strong>{r.qty > 1 ? ` × ${r.qty}` : ''}{r.serialNo ? <span className="font-mono text-muted-foreground"> · {r.serialNo}</span> : null}
              {r.complaintNo && r.complaintId && <> · <Link href={`/services/complaints/${r.complaintId}`} className="font-mono text-brand hover:underline">{r.complaintNo}</Link></>}
              <span className="block text-xs text-muted-foreground">{day(r.since)}{r.reason ? ` · ${r.reason}` : ''}</span>
            </span>
            <span className="tabular-nums">{formatCurrency(r.valuePaise)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="grid gap-4">
      <PageHeader badge="DS" title="Dead stock & scrap" subtitle="Old and faulty units that are not sellable - waiting for a decision, or scrapped" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Waiting for a decision</p><p className="text-xl font-semibold tabular-nums">{formatCurrency(sum(waiting))}</p><p className="text-xs text-muted-foreground">{waiting.length} item{waiting.length === 1 ? '' : 's'}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Scrapped</p><p className="text-xl font-semibold tabular-nums">{formatCurrency(sum(scrapped))}</p><p className="text-xs text-muted-foreground">{scrapped.length} item{scrapped.length === 1 ? '' : 's'}</p></Card>
      </div>
      <SectionCard title={`Waiting for a decision (${waiting.length})`} icon="clock" bodyClassName="p-0">
        {list(waiting, 'No old units waiting. When the store receives an old unit from a replacement, it appears here until it is sent to the supplier or scrapped.')}
      </SectionCard>
      <SectionCard title={`Scrapped (${scrapped.length})`} icon="trash" bodyClassName="p-0">
        {list(scrapped, 'Nothing scrapped yet. Open a case and use "Scrap now" (never sent) or "Received back → Scrapped".')}
      </SectionCard>
      <p className="text-xs text-muted-foreground">Value = what the unit cost us (its own purchase cost, else the product&apos;s current cost). To decide on an item, open its case in <Link href="/services/replacements" className="text-brand hover:underline">Services → Replacements</Link>.</p>
    </div>
  );
}
