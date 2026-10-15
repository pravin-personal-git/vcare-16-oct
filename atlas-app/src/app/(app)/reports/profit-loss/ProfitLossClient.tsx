'use client';
import { DateRangePresets } from '@/components/ui/DateRangePresets';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { COST_METHODS, type CostMethod } from '@/lib/costing';
import { istDate } from '@/lib/date-ranges';

interface PnLVM {
  from: string;
  to: string;
  costMethod: CostMethod;
  revenuePaise: number;
  creditNotesPaise: number;
  netRevenuePaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  grossMarginPct: number;
  expensesPaise: number;
  indicativeNetPaise: number;
  outputTaxPaise: number;
  inputTaxPaise: number;
  netGstPaise: number;
  invoiceCount: number;
  billCount: number;
  productsWithoutCost: number;
  expenseLines: { label: string; amountPaise: number }[];
  revenueLines: { label: string; amountPaise: number }[];
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

// The INDIA calendar day (9 Oct 2026). `toISOString` gave the UTC day, so
// "this month" built at midnight India time asked for the 30th of last month.
const iso = (d: Date) => istDate(d);

export function ProfitLossClient({ pnl }: { pnl: PnLVM }) {
  const router = useRouter();
  const [from, setFrom] = useState(iso(new Date(pnl.from)));
  const [to, setTo] = useState(iso(new Date(pnl.to)));
  // Follow the report when the period changes (9 Oct 2026) - see GstReportClient.
  useEffect(() => { setFrom(iso(new Date(pnl.from))); setTo(iso(new Date(pnl.to))); }, [pnl.from, pnl.to]);

  const apply = () => router.push(`/reports/profit-loss?from=${from}&to=${to}`);

  const thisMonth = () => {
    const n = new Date();
    router.push(`/reports/profit-loss?from=${iso(new Date(n.getFullYear(), n.getMonth(), 1))}&to=${iso(n)}`);
  };

  const lastMonth = () => {
    const n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const end = new Date(n.getFullYear(), n.getMonth(), 0);
    router.push(`/reports/profit-loss?from=${iso(start)}&to=${iso(end)}`);
  };

  const methodLabel = COST_METHODS.find((m) => m.value === pnl.costMethod)?.label ?? pnl.costMethod;

  const cards: KpiCard[] = [
    {
      key: 'revenue', label: 'Net revenue', count: rupees(pnl.netRevenuePaise),
      subLabel: `${pnl.invoiceCount} invoice${pnl.invoiceCount === 1 ? '' : 's'}`,
      icon: 'receipt', tone: 'brand',
    },
    {
      key: 'gross', label: 'Gross profit', count: rupees(pnl.grossProfitPaise),
      subLabel: `${pnl.grossMarginPct}% margin`,
      icon: 'trending-up',
      tone: pnl.grossProfitPaise >= 0 ? 'success' : 'danger',
    },
    {
      key: 'net', label: 'Indicative net', count: rupees(pnl.indicativeNetPaise),
      subLabel: 'before salaries, rent, tax',
      icon: 'file-text',
      tone: pnl.indicativeNetPaise >= 0 ? 'success' : 'danger',
    },
    {
      key: 'gst', label: pnl.netGstPaise >= 0 ? 'GST payable' : 'GST reclaimable',
      count: rupees(Math.abs(pnl.netGstPaise)),
      subLabel: 'output less input', icon: 'credit-card',
      tone: pnl.netGstPaise > 0 ? 'warning' : 'info',
    },
  ];

  return (
    <>
      <PageHeader
        badge="PL"
        title="Profit & Loss"
        subtitle={`${fmtDate(pnl.from)} - ${fmtDate(pnl.to)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={thisMonth}>This month</Button>
            <Button size="sm" onClick={lastMonth}>Last month</Button>
          </div>
        }
      />

      {/* Above the numbers, not beside them. Somebody reading a profit figure
          has to know what is missing from it BEFORE they read it. */}
      <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
        <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 text-xs leading-relaxed">
          <strong>This is an indicative trading statement, not a statutory P&amp;L.</strong>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-4">
            <li>
              Salaries, rent, electricity and interest are <strong>not included</strong> unless
              you entered them as a purchase bill. Your real profit is lower than the figure below.
            </li>
            <li>
              Cost of goods sold is posted the moment stock physically leaves, using your cost
              method (<strong>{methodLabel}</strong>) at that moment - not from a stock take at
              each end of the period.
            </li>
            <li>
              Every expense account is read from the general ledger, so salaries, staff claims,
              travel, petty cash, incentives, rent and bank charges are all in the figure below -
              but only what was actually recorded. Money spent and never entered is invisible to
              any report.
            </li>
            <li>Depreciation and income tax are not included at all.</li>
          </ul>
          <p className="mt-1.5">
            Useful for &ldquo;is this month better than last&rdquo;. Not for filing.
          </p>
        </div>
      </Card>

      {pnl.productsWithoutCost > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>
              {pnl.productsWithoutCost} product{pnl.productsWithoutCost === 1 ? '' : 's'} sold in
              this period with no purchase cost on record today.
            </strong>{' '}
            If that was already true when the stock left, its cost posted as zero and the gross
            profit above is overstated by that much. Enter a purchase bill for them, or set a
            standard cost on the product - new movements will cost correctly, though a past one
            already posted keeps whatever it posted at the time.
          </p>
        </Card>
      )}

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2 shadow-card">
        {/* Tier B wants a date range with presets (F1-SPEC §3.1). Two raw date
            boxes meant knowing the financial year runs April to March, and
            typing both ends, before you could see a quarter's profit. */}
        <DateRangePresets onPick={(f, t) => { setFrom(f); setTo(t); }} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <input
            type="date"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <input
            type="date"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button variant="primary" onClick={apply}>Show</Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title="Trading" icon="trending-up">
          {pnl.revenueLines.map((l) => (
            <SummaryRow key={l.label} label={l.label} value={rupees(l.amountPaise)} />
          ))}
          <SummaryRow label="Total revenue" value={rupees(pnl.revenuePaise)} />
          {pnl.creditNotesPaise > 0 && (
            <SummaryRow
              label="Less credit notes"
              value={`− ${rupees(pnl.creditNotesPaise)}`}
              tone="danger"
            />
          )}
          <SummaryRow label="Net revenue" value={rupees(pnl.netRevenuePaise)} strong />

          <div className="mt-3">
            <SummaryRow
              label="Cost of goods sold"
              value={`− ${rupees(pnl.cogsPaise)}`}
              tone="danger"
            />
            <SummaryRow
              label="Gross profit"
              value={rupees(pnl.grossProfitPaise)}
              strong
              tone={pnl.grossProfitPaise >= 0 ? 'success' : 'danger'}
            />
          </div>

          <div className="mt-3">
            <SummaryRow
              label="Operating expenses"
              value={`− ${rupees(pnl.expensesPaise)}`}
              tone="danger"
            />
            <SummaryRow
              label="Indicative net"
              value={rupees(pnl.indicativeNetPaise)}
              strong
              tone={pnl.indicativeNetPaise >= 0 ? 'success' : 'danger'}
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Revenue is the taxable value, excluding GST - tax collected is money held for the
            government, not turnover. Stock bought but not yet sold is not an expense here; it
            becomes one through cost of goods sold when it actually sells.
          </p>
        </SectionCard>

        <div className="flex flex-col gap-3">
          <SectionCard title="GST for the period" icon="credit-card">
            <SummaryRow label="Output tax (collected)" value={rupees(pnl.outputTaxPaise)} />
            <SummaryRow label="Input tax (paid)" value={`− ${rupees(pnl.inputTaxPaise)}`} />
            <SummaryRow
              label={pnl.netGstPaise >= 0 ? 'Net payable' : 'Net reclaimable'}
              value={rupees(Math.abs(pnl.netGstPaise))}
              strong
              tone={pnl.netGstPaise > 0 ? 'danger' : 'success'}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A working figure from the documents entered, not a filed return. Credit notes
              reduce output tax, which is exactly why a credit note is a statutory document and
              not a note in the margin. Have your accountant check it before you pay anything.
            </p>
          </SectionCard>

          <SectionCard title="Expenses" icon="file-text" bodyClassName="p-0">
            {pnl.expenseLines.length === 0 ? (
              <p className="p-4 text-xs leading-relaxed text-muted-foreground">
                Nothing posted to an expense account in this period. Salaries appear here once a
                payroll run is processed; rent, electricity, petty cash and fuel once they are
                entered at Transactions or as a purchase bill.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {pnl.expenseLines.map((l) => (
                    <tr key={l.label} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{l.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {rupees(l.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Built from {pnl.invoiceCount} invoice{pnl.invoiceCount === 1 ? '' : 's'} and{' '}
        {pnl.billCount} purchase bill{pnl.billCount === 1 ? '' : 's'}.{' '}
        <Link href="/purchase/bills" className="text-brand hover:underline">
          Enter a purchase bill
        </Link>{' '}
        to make these numbers more complete.
      </p>
    </>
  );
}
