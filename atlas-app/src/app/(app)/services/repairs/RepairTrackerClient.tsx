'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { PageHeader, EmptyState, StatusBadge } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useRouter } from 'next/navigation';
import { useListParams } from '@/components/ui/useListParams';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { formatCurrency } from '@/lib/format';

type Challan = {
  id: string; challanNo: string; complaintId: string; complaintNo: string;
  customerId: string; customerName: string; productName: string; qty: number; costPaise: number; dispatchedAt: string;
  status: string; physicalChallanNo: string | null; technicianRemark: string | null; legacyRef: string | null;
  amcContractNo: string | null; amcItemised: boolean;
  assigneeIds: string[]; assigneeNames: string[];
};

/** Same vocabulary as the installation challan, deliberately - one word means one thing. */
const CHALLAN_STATUS: Record<string, string> = {
  pending: 'Pending', work_done: 'Work done', approved: 'Approved',
  rejected: 'Rejected', legacy_unknown: 'Not recorded',
};

export function RepairTrackerClient({
  challans, paging, totals, counts, status, rangeLabel, canExport, views, technicians = [],
}: {
  /** Challans per status inside the date and person filters - the cards. */
  counts: Record<string, number>;
  /** The challan-date range in force, in words. */
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  technicians?: { id: string; fullName: string }[];
  /** One page, searched and sorted on the server. */
  challans: Challan[];
  paging: ServerPaging;
  /** Over every challan in scope. */
  totals: { count: number; costPaise: number; units: number };
  status: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const list = useListParams();
  const cards: KpiCard[] = [
    { key: 'pending', label: 'Pending', count: counts.pending ?? 0, icon: 'clock', tone: 'warning' },
    { key: 'work_done', label: 'Work done', count: counts.work_done ?? 0, icon: 'check' },
    { key: 'approved', label: 'Approved', count: counts.approved ?? 0, icon: 'check-circle', tone: 'success' },
    { key: 'rejected', label: 'Rejected', count: counts.rejected ?? 0, icon: 'x-circle', tone: 'danger' },
    { key: 'legacy_unknown', label: 'Not recorded', count: counts.legacy_unknown ?? 0, icon: 'info' },
  ];

  /**
   * Was a plain <table> rendering every row.
   *
   * That was survivable while the server capped this list at 500. It is not
   * now: the cap was lifted (see lib/list-limits) and this store holds 6,819
   * challans, so every one of them was becoming a <tr> in the DOM - and the
   * screen had no search box at all, which is why the reviewer could not find
   * CCHN202602264 on the very page that was displaying it.
   *
   * DataGrid pages in the browser and renders one page at a time, so the row
   * count now drives the payload rather than the size of the table, and the
   * toolbar search covers every column below.
   */
  const columns: Column<Challan>[] = [
    {
      key: 'challanNo',
      header: 'Challan',
      width: '11rem',
      render: (c) => (
        <Link href={`/services/repairs/${c.id}`} className="block">
          <p className="font-mono text-xs font-semibold text-brand hover:underline">{c.challanNo}</p>
          {/* Several Atlas rows share one source reference, because one source
              challan became one row per product. Shown only when it differs. */}
          {c.legacyRef && c.legacyRef !== c.challanNo && (
            <p className="font-mono text-xs text-muted-foreground">was {c.legacyRef}</p>
          )}
        </Link>
      ),
      // Both numbers are searchable: the reviewer typed the un-suffixed source
      // number, which only exists in legacyRef.
      sortValue: (c) => `${c.challanNo} ${c.legacyRef ?? ''}`,
    },
    {
      key: 'complaintNo',
      header: 'Complaint',
      render: (c) => (
        <Link href={`/services/complaints/${c.complaintId}`} className="font-mono text-xs text-brand hover:underline">
          {c.complaintNo}
        </Link>
      ),
      sortValue: (c) => c.complaintNo,
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate"><CustomerLink id={c.customerId}>{c.customerName}</CustomerLink></p>
          {/*
            Worth showing on THIS screen above all: a repair challan is a part
            replaced at somebody's expense, and whether the customer holds
            cover is the question it settles. Says "Has AMC", not "covered" -
            the list answer has not matched the part.
          */}
          {c.amcContractNo && (
            <span
              title={`Customer holds ${c.amcContractNo}${c.amcItemised
                ? '. Covers specific equipment only - check the complaint.'
                : '. Covers the whole site.'}`}
              className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/[0.08] px-1.5 py-0.5 text-xs font-medium text-on-tint-success"
            >
              <Icon name="refresh" className="h-2.5 w-2.5" />
              Has AMC{c.amcItemised ? ' (partial)' : ''}
            </span>
          )}
        </div>
      ),
      sortValue: (c) => `${c.customerName} ${c.amcContractNo ?? ''}`,
    },
    {
      key: 'productName',
      header: 'Product',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate">{c.productName}</p>
          {c.technicianRemark && (
            <p className="truncate text-xs text-muted-foreground">{c.technicianRemark}</p>
          )}
        </div>
      ),
      sortValue: (c) => `${c.productName} ${c.technicianRemark ?? ''}`,
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'end',
      render: (c) => <span className="font-mono tabular-nums">{c.qty}</span>,
      sortValue: (c) => c.qty,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'end',
      render: (c) => <span className="font-mono text-xs tabular-nums">{formatCurrency(c.costPaise)}</span>,
      sortValue: (c) => c.costPaise,
    },
    {
      // Both recovered from the source system on 23 Sep 2026 - the approval
      // state and the number on the signed paper slip had no column here, so
      // 6,819 migrated rows had lost them.
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span title={c.status === 'legacy_unknown'
          ? 'This slip predates the approval column, and its real state could not be recovered from the old system. Not a guess either way.'
          : undefined}>
          <StatusBadge status={c.status === 'work_done' ? 'done' : c.status === 'legacy_unknown' ? 'not_recorded' : c.status} label={CHALLAN_STATUS[c.status] ?? c.status} />
        </span>
      ),
      sortValue: (c) => c.status,
    },
    {
      key: 'assignees',
      header: 'Assigned to',
      render: (c) => <span className="text-xs">{c.assigneeNames.join(', ') || '-'}</span>,
      sortValue: (c) => c.assigneeNames.join(', '),
    },
    {
      key: 'physicalChallanNo',
      header: 'Paper slip',
      render: (c) => (
        <span className="font-mono text-xs text-muted-foreground">{c.physicalChallanNo ?? '-'}</span>
      ),
      sortValue: (c) => c.physicalChallanNo,
    },
    {
      key: 'dispatchedAt',
      header: 'Date',
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {new Date(c.dispatchedAt).toLocaleDateString('en-IN')}
        </span>
      ),
      sortValue: (c) => new Date(c.dispatchedAt).getTime(),
    },
  ];

  return (
    <div>
      <PageHeader
        badge="RC"
        // "Repair challans (history)" since 11 Oct 2026 - the menu and the
        // heading say what the page is for: looking things up, not giving parts.
        title="Repair challans (history)"
        subtitle="Every part or replacement given out on a complaint, and the old Vcare repair slips. Look things up here - to give a part now, open the complaint."
        actions={<Link href="/services/complaints" className={buttonClass('tint')}><Icon name="arrow-right" className="h-4 w-4" />Go to complaints</Link>}
      />

      {/* G-05 (5 Oct 2026): the three tiles repeated the status cards below
          ("Challans raised" was their sum) and took a third of the screen.
          The two figures the cards do not carry now sit in one line. */}
      <p className="mb-3 text-sm text-muted-foreground">
        <strong className="text-foreground">{totals.count.toLocaleString('en-IN')}</strong> challans
        {' · '}<strong className="text-foreground">{formatCurrency(totals.costPaise)}</strong> replacement cost
        {' · '}<strong className="text-foreground">{totals.units.toLocaleString('en-IN')}</strong> units dispatched
      </p>

      {totals.count === 0 ? (
        <EmptyState icon="truck" title="No repair challans yet" hint="New parts are raised on the complaint (Parts → Raise challan)." />
      ) : (
        <>
          <FilterBar
            searchPlaceholder="Challan no, paper slip, complaint no, customer, product, technician…"
            dates={{ defaultPreset: 'all', label: 'Challan date', activeLabel: rangeLabel }}
            people={{ label: 'Technician', options: technicians }}
            shown={paging.total}
            clearKeys={['status', 'mine', 'tech']}
            exportScreen={canExport ? 'repairs' : null}
            views={views}
          />

          <KpiStrip cards={cards} activeKey={status} onSelect={(k) => list.set({ status: k })} columns={5} />

          <DataGrid
            rows={challans}
            server={paging}
            columns={columns}
            rowKey={(c) => c.id}
            emptyIcon="truck"
            emptyMessage="No challans match"
            mobileCard={(c) => (
              <Link href={`/services/repairs/${c.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-brand">{c.challanNo}</span>
                  <StatusBadge status={c.status === 'work_done' ? 'done' : c.status === 'legacy_unknown' ? 'not_recorded' : c.status} label={CHALLAN_STATUS[c.status] ?? c.status} />
                </div>
                <p className="mt-1 truncate text-sm font-medium">{c.customerName}</p>
                <p className="truncate text-xs text-muted-foreground">{c.qty} × {c.productName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(c.dispatchedAt).toLocaleDateString('en-IN')} · {c.assigneeNames.join(', ') || 'No one assigned'}
                  {c.physicalChallanNo && ` · slip ${c.physicalChallanNo}`}
                </p>
              </Link>
            )}
            actions={[
              { label: 'Open challan', icon: 'external-link', iconTone: 'brand', onSelect: (c) => router.push(`/services/repairs/${c.id}`) },
              { label: 'Open complaint', icon: 'alert-circle', onSelect: (c) => router.push(`/services/complaints/${c.complaintId}`) },
            ]}
            emptyHint="Challan numbers were split per product on import, so the number on the paper slip may carry a -1, -2 suffix. Searching without the suffix finds them all."
            pageSummary={(pageRows) => (
              <>
                <span className="text-muted-foreground">
                  On this page: <strong className="text-foreground">{pageRows.length}</strong>
                </span>
                <span className="text-muted-foreground">
                  Page cost:{' '}
                  <strong className="text-foreground">
                    {formatCurrency(pageRows.reduce((n, c) => n + c.costPaise, 0))}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  Page units:{' '}
                  <strong className="text-foreground">{pageRows.reduce((n, c) => n + c.qty, 0)}</strong>
                </span>
              </>
            )}
          />
        </>
      )}

    </div>
  );
}
