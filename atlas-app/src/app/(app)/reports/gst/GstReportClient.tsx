'use client';
import { DateRangePresets } from '@/components/ui/DateRangePresets';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, SectionCard, Segmented } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { istDate } from '@/lib/date-ranges';

interface DocRowVM {
  id: string;
  docNo: string;
  date: string;
  partyName: string;
  docHref: string;
  partyHref: string | null;
  gstin: string | null;
  isB2B: boolean;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
}

interface HsnRowVM {
  hsnCode: string;
  taxRatePct: number;
  qty: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

interface ReportVM {
  from: string;
  to: string;
  outputTaxPaise: number;
  inputTaxPaise: number;
  netPayablePaise: number;
  invoiceCount: number;
  creditNoteCount: number;
  billCount: number;
  sales: DocRowVM[];
  creditNotes: DocRowVM[];
  purchases: DocRowVM[];
  hsnOutward: HsnRowVM[];
  hsnInward: HsnRowVM[];
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

// The INDIA calendar day (9 Oct 2026). `toISOString` gave the UTC day, so
// "this month" built at midnight India time asked for the 30th of last month.
const iso = (d: Date) => istDate(d);

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function GstReportClient({ report }: { report: ReportVM }) {
  const router = useRouter();
  const [from, setFrom] = useState(iso(new Date(report.from)));
  const [to, setTo] = useState(iso(new Date(report.to)));
  // Follow the report when the period changes - This month / Last month push a
  // new address and the boxes kept showing the old dates (9 Oct 2026).
  useEffect(() => { setFrom(iso(new Date(report.from))); setTo(iso(new Date(report.to))); }, [report.from, report.to]);
  const [tab, setTab] = useState<'sales' | 'purchase' | 'hsn'>('sales');

  const apply = () => router.push(`/reports/gst?from=${from}&to=${to}`);

  const thisMonth = () => {
    const n = new Date();
    router.push(`/reports/gst?from=${iso(new Date(n.getFullYear(), n.getMonth(), 1))}&to=${iso(n)}`);
  };

  const lastMonth = () => {
    const n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const end = new Date(n.getFullYear(), n.getMonth(), 0);
    router.push(`/reports/gst?from=${iso(start)}&to=${iso(end)}`);
  };

  const cards: KpiCard[] = [
    {
      key: 'output', label: 'Sales GST (output)', count: rupees(report.outputTaxPaise),
      subLabel: `${report.invoiceCount} invoice${report.invoiceCount === 1 ? '' : 's'}`
        + (report.creditNoteCount > 0 ? `, ${report.creditNoteCount} credit note${report.creditNoteCount === 1 ? '' : 's'}` : ''),
      icon: 'trending-up', tone: 'brand',
    },
    {
      key: 'input', label: 'Purchase GST (input)', count: rupees(report.inputTaxPaise),
      subLabel: `${report.billCount} bill${report.billCount === 1 ? '' : 's'}`, icon: 'truck',
    },
    {
      key: 'net', label: report.netPayablePaise >= 0 ? 'Net payable' : 'Net reclaimable',
      count: rupees(Math.abs(report.netPayablePaise)),
      subLabel: 'output less input', icon: 'credit-card',
      tone: report.netPayablePaise > 0 ? 'danger' : 'success',
    },
  ];

  return (
    <>
      <PageHeader
        badge="GS"
        title="GST Computation"
        subtitle={`${fmtDate(report.from)} - ${fmtDate(report.to)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={thisMonth}>This month</Button>
            <Button size="sm" onClick={lastMonth}>Last month</Button>
            <Button size="sm" icon="download" onClick={() => downloadJson(`gst-${from}-to-${to}.json`, report)}>
              Export JSON
            </Button>
          </div>
        }
      />

      <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
        <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 text-xs leading-relaxed">
          <strong>A working figure, not a filed return.</strong>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-4">
            <li>Totalled from invoices, credit notes and purchase bills already entered - nothing is filed or sent anywhere from this screen.</li>
            <li>No carry-forward from a prior period and no record of what was actually paid to the government - both need a real ledger, not yet built.</li>
            <li>Have your accountant check it before you file or pay anything.</li>
          </ul>
        </div>
      </Card>

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2 shadow-card">
        {/* GST is filed per month, so "Last month" is the period this screen is
            opened for nine times out of ten (F1-SPEC §3.1 Tier B). */}
        <DateRangePresets onPick={(f, t) => { setFrom(f); setTo(t); }} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <input type="date" className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <input type="date" className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button variant="primary" onClick={apply}>Show</Button>
      </div>

      <div className="mb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sales', label: 'Sales GST (GSTR-1)' },
            { value: 'purchase', label: 'Purchase GST' },
            { value: 'hsn', label: 'HSN Summary' },
          ]}
        />
      </div>

      {tab === 'sales' && (
        <div className="flex flex-col gap-3">
          <SectionCard title={`Invoices - ${report.sales.length}`} icon="receipt" bodyClassName="p-0">
            <DocTable rows={report.sales} emptyText="No invoices issued in this period." />
          </SectionCard>
          {report.creditNotes.length > 0 && (
            <SectionCard title={`Credit notes - ${report.creditNotes.length}`} icon="rotate-ccw" bodyClassName="p-0">
              <DocTable rows={report.creditNotes} emptyText="No credit notes in this period." negative />
            </SectionCard>
          )}
        </div>
      )}

      {tab === 'purchase' && (
        <SectionCard title={`Purchase bills - ${report.purchases.length}`} icon="truck" bodyClassName="p-0">
          <DocTable rows={report.purchases} emptyText="No purchase bills posted in this period." />
        </SectionCard>
      )}

      {tab === 'hsn' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SectionCard title="Outward supplies (sales, net of credit notes)" icon="trending-up" bodyClassName="p-0">
            <HsnTable rows={report.hsnOutward} />
          </SectionCard>
          <SectionCard title="Inward supplies (purchases)" icon="truck" bodyClassName="p-0">
            <HsnTable rows={report.hsnInward} />
          </SectionCard>
        </div>
      )}
    </>
  );
}

function DocTable({ rows, emptyText, negative }: { rows: DocRowVM[]; emptyText: string; negative?: boolean }) {
  if (rows.length === 0) {
    return <p className="p-4 text-xs leading-relaxed text-muted-foreground">{emptyText}</p>;
  }
  const sign = negative ? -1 : 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Document</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">Party</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 text-right font-semibold">Taxable</th>
            <th className="px-3 py-2 text-right font-semibold">CGST</th>
            <th className="px-3 py-2 text-right font-semibold">SGST</th>
            <th className="px-3 py-2 text-right font-semibold">IGST</th>
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium"><Link href={r.docHref} className="text-brand hover:underline">{r.docNo}</Link></td>
              <td className="px-3 py-2 text-xs">{fmtDate(r.date)}</td>
              <td className="px-3 py-2">{r.partyHref ? <Link href={r.partyHref} className="hover:text-brand hover:underline">{r.partyName}</Link> : r.partyName}</td>
              <td className="px-3 py-2 text-xs">{r.isB2B ? 'B2B' : 'B2C'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(sign * r.taxableBasePaise)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(sign * r.cgstPaise)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(sign * r.sgstPaise)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(sign * r.igstPaise)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{rupees(sign * r.grandTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HsnTable({ rows }: { rows: HsnRowVM[] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-xs leading-relaxed text-muted-foreground">Nothing in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-semibold">HSN / SAC</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Taxable</th>
            <th className="px-3 py-2 text-right font-semibold">Tax</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.hsnCode}-${r.taxRatePct}`} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium">{r.hsnCode}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.taxRatePct}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(r.taxableBasePaise)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(r.cgstPaise + r.sgstPaise + r.igstPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
