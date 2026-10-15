'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Button, buttonClass } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { getFinancialYear, financialYearRange } from '@/lib/financial-year';
import { istDate } from '@/lib/date-ranges';
import { inrC, inrFull } from '@/lib/dash/format';

interface LineVM {
  key: string;
  label: string;
  paise: number;
  basis: 'derived' | 'entered' | 'mixed';
  calc: { label: string; paise: number }[];
  madeOf: { label: string; paise: number; href?: string }[];
  from: string;
  route?: string;
}

interface SheetVM {
  asOf: string;
  openingAsOf: string | null;
  hasOpening: boolean;
  assets: LineVM[];
  liabilities: LineVM[];
  equity: LineVM[];
  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  totalEquityPaise: number;
  netWorthPaise: number;
  accumulatedResultPaise: number;
  kpi: {
    workingCapitalPaise: number;
    currentRatio: number | null;
    debtToEquity: number | null;
    daysOfCash: number | null;
    currentAssetsPaise: number;
    currentLiabilitiesPaise: number;
    cashPaise: number;
    receivablePaise: number;
    overdue30Paise: number;
    outflow90Paise: number;
  };
  previous: { asOf: string; netWorthPaise: number | null };
  months: { label: string; asOf: string; netWorthPaise: number | null }[];
  stockAtTodaysCost: boolean;
}

/** Full rupees for the statement, lakh-style for the tiles and chart. */
const full = (p: number) => inrFull(p / 100);
const compact = (p: number) => inrC(p / 100);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

// The INDIA calendar day (9 Oct 2026). `toISOString` gave the UTC day, so
// "this month" built at midnight India time asked for the 30th of last month.
const iso = (d: Date) => istDate(d);

/**
 * Where the business stands (area K, 11 Oct 2026 - ops-pages demo tab 11).
 *
 * A dashboard on top - six tiles, net worth by month, own vs owe - then the
 * statement, where every line opens to show how it is worked out, what it is
 * made of (each part a link to its list) and one line saying where it comes
 * from. Every figure is the server's (server/balance-sheet.ts); nothing on
 * this screen is computed from anything but what it was handed.
 *
 * The long disclaimer that used to sit above the numbers is now one line
 * under the check row, where a reader meets the matching totals.
 */
export function BalanceSheetClient({
  sheet, canEdit,
}: {
  sheet: SheetVM;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [asOf, setAsOf] = useState(iso(new Date(sheet.asOf)));
  // Follow the sheet when the date changes (9 Oct 2026) - see GstReportClient.
  useEffect(() => { setAsOf(iso(new Date(sheet.asOf))); }, [sheet.asOf]);
  const [open, setOpen] = useState<string | null>('cash');

  const go = (d?: string) => router.push(d ? `/reports/balance-sheet?asOf=${d}` : '/reports/balance-sheet');
  const fyEnd = () => go(iso(financialYearRange(getFinancialYear()).end));

  const k = sheet.kpi;
  const change = sheet.previous.netWorthPaise == null ? null : sheet.netWorthPaise - sheet.previous.netWorthPaise;
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  return (
    <>
      <PageHeader
        badge="BS"
        title="Balance Sheet"
        subtitle={`As at ${fmtDate(sheet.asOf)} · compared with ${fmtDate(sheet.previous.asOf)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => go()}>Today</Button>
            <Button size="sm" onClick={fyEnd}>Financial year end</Button>
            <input
              type="date"
              aria-label="As at"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            />
            <Button size="sm" variant="primary" onClick={() => go(asOf)}>Apply</Button>
            {canEdit && (
              <Link href="/settings/opening-balance" className={buttonClass('tint', 'sm')}>
                <Icon name="settings" className="h-3.5 w-3.5" />Opening balances
              </Link>
            )}
          </div>
        }
      />

      {!sheet.hasOpening && (
        <Card className="mb-4 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="flex-1 text-xs leading-relaxed">
            <strong>No opening balances yet, so this is badly incomplete.</strong>{' '}
            Atlas works out what customers owe, what you owe suppliers and what stock is worth from
            your documents. It cannot know what was in the bank on the day you started, or what you
            put into the business - usually the largest figures here.
            {canEdit && (
              <Link href="/settings/opening-balance" className="ms-1 font-medium text-brand hover:underline">
                Enter them once →
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* The six tiles - each says in one line what it means. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Net worth"
          value={compact(sheet.netWorthPaise)}
          tone={sheet.netWorthPaise < 0 ? 'danger' : undefined}
          sub={change == null
            ? 'no figure for last month-end'
            : change === 0 ? `no change since ${fmtDate(sheet.previous.asOf)}`
            : `${change >= 0 ? '+' : '−'} ${compact(Math.abs(change))} since ${fmtDate(sheet.previous.asOf)}`}
          subTone={change == null ? undefined : change >= 0 ? 'success' : 'danger'}
          why="What you own less what you owe."
        />
        <Tile
          label="Cash & bank"
          value={compact(k.cashPaise)}
          tone={k.cashPaise < 0 ? 'danger' : undefined}
          // Past a year the exact count means nothing - "1815 days" just looks odd (Pravin, 11 Oct 2026).
          sub={k.daysOfCash == null ? 'nothing paid out in 90 days'
            : k.daysOfCash > 365 ? 'over a year of payments out'
            : `about ${k.daysOfCash} days of payments out`}
          why={`Cash ÷ the daily pace of supplier payments over the last 90 days (${compact(k.outflow90Paise)}). Expenses and salaries are not in that pace yet.`}
        />
        <Tile
          label="Working capital"
          value={compact(k.workingCapitalPaise)}
          tone={k.workingCapitalPaise < 0 ? 'danger' : undefined}
          sub="short-term assets − short-term dues"
          why={`Cash, money owed to you, stock and advances paid (${compact(k.currentAssetsPaise)}) less supplier bills, GST and customer advances (${compact(k.currentLiabilitiesPaise)}).`}
        />
        <Tile
          label="Current ratio"
          value={k.currentRatio == null ? '-' : `${k.currentRatio.toFixed(1)}×`}
          tone={k.currentRatio == null ? undefined : k.currentRatio >= 1.5 ? 'success' : k.currentRatio < 1 ? 'danger' : 'warning'}
          sub={k.currentRatio == null ? 'nothing due short-term' : 'comfortable above 1.5×'}
          why="Short-term assets ÷ short-term dues. Below 1× you could not pay everything due from what you hold."
        />
        <Tile
          label="Debt to equity"
          value={k.debtToEquity == null ? '-' : k.debtToEquity.toFixed(2)}
          sub={k.debtToEquity == null ? 'net worth is not positive' : 'loans ÷ net worth'}
          why="How much of the business is funded by borrowing for every rupee that is yours."
        />
        <Tile
          label="Owed to you"
          value={compact(k.receivablePaise)}
          sub={k.overdue30Paise > 0 ? `${compact(k.overdue30Paise)} over 30 days late` : 'nothing over 30 days late'}
          subTone={k.overdue30Paise > 0 ? 'danger' : 'success'}
          why="Unpaid invoices. The late part is more than 30 days past its due date."
          href="/invoices?card=overdue"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Net worth by month" icon="bar-chart" className="lg:col-span-2">
          <MonthBars months={sheet.months} />
          {sheet.stockAtTodaysCost && (
            <p className="mt-2 text-xs text-muted-foreground">
              Past month-ends take stock back to that day&apos;s quantities, valued at today&apos;s cost.
            </p>
          )}
        </SectionCard>
        <SectionCard title="Own vs owe" icon="pie-chart">
          <div className="space-y-3 text-sm">
            {[
              { l: 'You own', v: sheet.totalAssetsPaise, c: 'bg-success' },
              { l: 'You owe', v: sheet.totalLiabilitiesPaise, c: 'bg-danger' },
              { l: 'Left for you', v: sheet.netWorthPaise, c: 'bg-brand' },
            ].map((r) => (
              <div key={r.l}>
                <div className="flex justify-between">
                  <span>{r.l}</span>
                  <span className="font-semibold tabular-nums">{full(r.v)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`dash-bar h-full rounded-full ${r.c}`}
                    style={{ width: `${sheet.totalAssetsPaise > 0 ? Math.max(0, Math.min(100, (r.v / sheet.totalAssetsPaise) * 100)) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Section title="What the business owns" sub="Assets" icon="package" lines={sheet.assets} total={sheet.totalAssetsPaise} open={open} onToggle={toggle} canEdit={canEdit} />
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="What it owes" sub="Liabilities" icon="credit-card" lines={sheet.liabilities} total={sheet.totalLiabilitiesPaise} open={open} onToggle={toggle} canEdit={canEdit} />
          <Section title="What is left over" sub="Equity" icon="trending-up" lines={sheet.equity} total={sheet.totalEquityPaise} open={open} onToggle={toggle} canEdit={canEdit} />

          <Card className="p-4 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Assets</span><span className="tabular-nums">{full(sheet.totalAssetsPaise)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Liabilities + equity</span>
              <span className="tabular-nums">{full(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise)}</span>
            </div>
            {/* The one-line caveat, next to the matching numbers it is about. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Equity is assets minus liabilities, so this always matches - a position statement, not the filed balance sheet.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Tile({
  label, value, sub, why, tone, subTone, href,
}: {
  label: string;
  value: string;
  sub: string;
  why: string;
  tone?: 'success' | 'danger' | 'warning';
  subTone?: 'success' | 'danger';
  href?: string;
}) {
  const ink = { success: 'text-success', danger: 'text-danger', warning: 'text-warning' };
  const body = (
    <>
      <p className="text-micro font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone ? ink[tone] : ''}`}>{value}</p>
      <p className={`text-xs ${subTone ? ink[subTone] : 'text-muted-foreground'}`}>{sub}</p>
      <p className="mt-1.5 text-cap leading-snug text-muted-foreground">{why}</p>
    </>
  );
  const cls = 'dash-tile dash-rise block min-w-0 rounded-lg border border-border bg-card p-4';
  return href
    ? <Link href={href} title={why} className={cls}>{body}</Link>
    : <div title={why} className={cls}>{body}</div>;
}

function MonthBars({ months }: { months: SheetVM['months'] }) {
  const values = months.map((m) => m.netWorthPaise ?? 0);
  const max = Math.max(1, ...values.map(Math.abs));
  if (months.every((m) => m.netWorthPaise == null)) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No month-end since the opening balances yet.</p>;
  }
  return (
    <div className="flex h-44 items-end gap-2 sm:gap-3">
      {months.map((m, i) => (
        <div key={m.asOf} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={m.netWorthPaise == null ? 'Before the opening balances' : `${m.label}: ${inrFull(m.netWorthPaise / 100)}`}>
          <span className="text-cap tabular-nums text-muted-foreground">
            {m.netWorthPaise == null ? '-' : compact(m.netWorthPaise)}
          </span>
          <div
            className={`dash-rise w-full rounded-t-sm ${m.netWorthPaise == null ? 'bg-muted' : m.netWorthPaise < 0 ? 'bg-danger/80' : i === months.length - 1 ? 'bg-brand' : 'bg-brand/60'}`}
            style={{ height: `${m.netWorthPaise == null ? 4 : Math.max(4, (Math.abs(m.netWorthPaise) / max) * 120)}px`, animationDelay: `${i * 0.04}s` }}
          />
          <span className="text-cap text-muted-foreground">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

const BASIS: Record<LineVM['basis'], { label: string; tone: 'success' | 'neutral' | 'info' }> = {
  derived: { label: 'from your records', tone: 'success' },
  entered: { label: 'typed in', tone: 'neutral' },
  mixed: { label: 'typed opening + records', tone: 'info' },
};

function Section({
  title, sub, icon, lines, total, open, onToggle, canEdit,
}: {
  title: string;
  sub: string;
  icon: 'package' | 'credit-card' | 'trending-up';
  lines: LineVM[];
  total: number;
  open: string | null;
  onToggle: (k: string) => void;
  canEdit: boolean;
}) {
  return (
    <SectionCard
      title={title}
      icon={icon}
      action={
        <span className="flex items-baseline gap-2">
          <span className="text-micro uppercase text-muted-foreground">{sub}</span>
          <span className="text-lg font-bold tabular-nums">{full(total)}</span>
        </span>
      }
      bodyClassName="p-0"
    >
      {lines.map((l) => {
        const isOpen = open === l.key;
        const calcTotal = l.calc.reduce((n, c) => n + c.paise, 0);
        return (
          <div key={l.key} className="border-t border-border first:border-t-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onToggle(l.key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface"
            >
              <Icon name="chevron-right" className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="font-medium">{l.label}</span>
                <Badge tone={BASIS[l.basis].tone}>{BASIS[l.basis].label}</Badge>
              </span>
              <span className={`font-semibold tabular-nums ${l.paise < 0 ? 'text-danger' : ''}`}>{full(l.paise)}</span>
            </button>
            {isOpen && (
              <div className="dash-rise grid gap-4 bg-surface px-4 py-4 md:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">How it is worked out</p>
                  {l.calc.map((c) => (
                    <div key={c.label} className="flex justify-between gap-3 py-0.5 text-sm">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="shrink-0 tabular-nums">{full(c.paise)}</span>
                    </div>
                  ))}
                  {/* The GST line can carry "the government owes you" below the
                      sum; the total shown is always the line's own figure. */}
                  <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 text-sm font-semibold">
                    <span>{l.label}</span>
                    <span className="tabular-nums">{full(l.paise)}</span>
                  </div>
                  {calcTotal !== l.paise && l.key !== 'gst' && (
                    <p className="mt-1 text-xs text-warning">The parts add to {full(calcTotal)} - please report this.</p>
                  )}
                </div>
                <div className="min-w-0">
                  {l.madeOf.length > 0 && (
                    <>
                      <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Made of</p>
                      {l.madeOf.map((m) => (
                        <div key={m.label} className="flex justify-between gap-3 py-0.5 text-sm">
                          {m.href
                            ? <Link href={m.href} className="truncate text-brand hover:underline">{m.label}</Link>
                            : <span className="truncate">{m.label}</span>}
                          <span className="shrink-0 tabular-nums">{full(m.paise)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    <Icon name="alert-circle" className="mt-0.5 h-3 w-3 shrink-0" />
                    <span><b>From:</b> {l.from}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {l.basis !== 'derived' && canEdit && (
                      <Link href="/settings/opening-balance" className={buttonClass('soft', 'sm')}>
                        <Icon name="settings" className="h-3.5 w-3.5 text-muted-foreground" />Typed in · edit
                      </Link>
                    )}
                    {l.route && l.route !== '/settings/opening-balance' && (
                      <Link href={l.route} className={buttonClass('tint', 'sm')}>
                        <Icon name="arrow-up-right" className="h-3.5 w-3.5" />Open the entries
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </SectionCard>
  );
}
