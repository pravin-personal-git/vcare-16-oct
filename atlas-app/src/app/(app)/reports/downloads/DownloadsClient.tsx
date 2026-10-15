'use client';

import { useMemo, useState } from 'react';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Toolbar, FilterChip } from '@/components/ui/Toolbar';
import { Button, buttonClass } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { istDate } from '@/lib/date-ranges';

interface ReportVM {
  id: string;
  name: string;
  description: string;
  category: string;
  dated: boolean;
}

const CATEGORY_ICON: Record<string, IconName> = {
  Sales: 'trending-up',
  Purchase: 'receipt',
  Accounts: 'credit-card',
  Inventory: 'package',
  People: 'users',
  Service: 'settings',
  Tasks: 'check-circle',
  CRM: 'user-plus',
  Calls: 'phone',
  Attendance: 'calendar',
  Audit: 'eye',
};

// The INDIA calendar day (9 Oct 2026). `toISOString` gave the UTC day, so
// "this month" built at midnight India time asked for the 30th of last month.
const iso = (d: Date) => istDate(d);

/**
 * The download centre.
 *
 * ONE DATE RANGE AT THE TOP, NOT ONE PER CARD.
 *
 * Somebody exporting for their accountant wants the same quarter across six
 * reports. A range on each card means setting it six times and getting one of
 * them wrong - and a mismatched range between two files is the kind of error
 * that is only discovered by the accountant, weeks later.
 *
 * Reports that are a snapshot of right now - stock on hand, payables - say so
 * and ignore the range, rather than silently accepting one that does nothing.
 */
export function DownloadsClient({
  reports, hiddenCount, badge = 'DL', title = 'Reports & Downloads', subtitle,
}: {
  reports: ReportVM[];
  hiddenCount: number;
  /** Lets a narrower export screen (e.g. HRM Reports, §4.10) reuse this whole component under its own heading rather than duplicating the list/filter/download UI. */
  badge?: string;
  title?: string;
  subtitle?: string;
}) {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(reports.map((r) => r.category))].sort(),
    [reports],
  );

  const shown = reports.filter((r) => {
    if (category && r.category !== category) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${r.name} ${r.description} ${r.category}`.toLowerCase().includes(q);
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ReportVM[]>();
    for (const r of shown) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const url = (r: ReportVM, format: 'xlsx' | 'csv' = 'xlsx') =>
    (r.dated
      ? `/api/reports/download?id=${r.id}&from=${from}&to=${to}`
      : `/api/reports/download?id=${r.id}`) + (format === 'csv' ? '&format=csv' : '');

  const preset = (months: number) => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - months + 1, 1);
    setFrom(iso(start));
    setTo(iso(end));
  };

  const financialYear = () => {
    // India's financial year runs April to March. Somebody asking for "this
    // year" in a business context means this, not January.
    const n = new Date();
    const startYear = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
    setFrom(iso(new Date(startYear, 3, 1)));
    setTo(iso(n));
  };

  return (
    <>
      <PageHeader
        badge={badge}
        title={title}
        subtitle={subtitle ?? `${reports.length} reports · export to Excel or print to PDF`}
      />

      <SectionCard title="Period" icon="clock" className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
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
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => preset(1)}>This month</Button>
            <Button size="sm" onClick={() => preset(3)}>Last 3 months</Button>
            <Button size="sm" onClick={financialYear}>This financial year</Button>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Set it once here and it applies to every dated report below. Reports marked
          <strong> Snapshot</strong> always show the position right now and ignore this.
        </p>
      </SectionCard>

      <Toolbar
        filters={
          <>
            <FilterChip label="All" active={!category} onClick={() => setCategory(null)} />
            {categories.map((c) => (
              <FilterChip
                key={c} label={c} icon={CATEGORY_ICON[c]}
                active={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              />
            ))}
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search reports…"
      />

      {grouped.length === 0 && (
        <Card className="px-4 py-8 text-center">
          <Icon name="search" className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No report matches that</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a broader word - &ldquo;stock&rdquo;, &ldquo;GST&rdquo;, &ldquo;supplier&rdquo;.
          </p>
        </Card>
      )}

      {grouped.map(([cat, list]) => (
        <SectionCard
          key={cat}
          title={cat}
          icon={CATEGORY_ICON[cat] ?? 'file-text'}
          className="mb-4"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {list.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{r.name}</span>
                    {!r.dated && <Badge tone="neutral">Snapshot</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {r.description}
                  </p>
                </div>
                {/*
                  A plain anchor with `download`, not a fetch-and-blob dance.
                  The browser streams the file straight to disk, shows its own
                  progress, and works when the export is large - all of which a
                  JavaScript download reimplements badly.
                */}
                <div className="flex shrink-0 gap-1.5">
                  <a href={url(r)} download className={`${buttonClass('primary')} gap-2`} aria-label={`Download ${r.name} as Excel`}>
                    <Icon name="download" className="h-4 w-4" />Excel
                  </a>
                  <a href={url(r, 'csv')} download className={buttonClass('outline')} aria-label={`Download ${r.name} as CSV`}>CSV</a>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}

      {hiddenCount > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {hiddenCount} further report{hiddenCount === 1 ? ' is' : 's are'} available to roles with
          more permissions than yours.
        </p>
      )}

      <SectionCard title="About these files" icon="file-text" className="mt-4">
        <ul className="list-disc space-y-1.5 ps-5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Files are <strong>CSV</strong>, which Excel and Google Sheets open by double-click.
            They carry no formatting - no bold headers or frozen panes - because the point is
            data you can sort and pivot yourself.
          </li>
          <li>
            Amounts are in <strong>rupees</strong>, not paise, so a column sums to what your bank
            statement says.
          </li>
          <li>
            For <strong>PDF</strong>, open the screen you want and print it - every browser offers
            &ldquo;Save as PDF&rdquo; in the print dialog. That gives a properly paginated document
            without this software guessing your page size.
          </li>
          <li>
            Figures are live at the moment you download. Two exports taken minutes apart can
            legitimately differ if somebody raised an invoice in between.
          </li>
        </ul>
      </SectionCard>
    </>
  );
}
