'use client';

import { customColumns } from '@/components/custom-fields/list-columns';
import type { ListColumns } from '@/server/custom-fields';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, type BadgeTone } from '@/components/ui/Layout';
import { Button, ToggleChip } from '@/components/ui/Button';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { filterImpliesClosed, type LeadRow } from '@/lib/lead-metrics';
import { LeadForm } from './LeadForm';
import { takeHandoff } from '@/components/scan/handoff';
import type { VisitingCardScan } from '@/lib/scan/extraction';
import { LeadDrawer } from './LeadDrawer';
import { contactActions } from '@/lib/quick-actions';
import { whatsappLink } from '@/lib/revenue';

interface Props {
  /** Settings > Custom Fields marked "Show in list". */
  extraColumns?: ListColumns;
  /** One page, filtered on the server (server/leads-list). */
  rows: LeadRow[];
  paging: ServerPaging;
  card: string | null;
  closed: boolean;
  rangeLabel: string;
  people: { id: string; fullName: string }[];
  canExport: boolean;
  views: FilterBarViews;
  summary: ReturnType<typeof import('@/lib/lead-metrics').summarise>;
  stages: { id: string; name: string; isGroupHeader: boolean; parentId: string | null }[];
  dealStages: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  canCreate: boolean;
  scopeIsAll: boolean;
  /** From ?open= - opens this lead's drawer straight away. */
  openId?: string | null;
}

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '-';

const DEAL_TONE: Record<string, BadgeTone> = {
  Hot: 'danger',
  Warm: 'warning',
  Cold: 'info',
};

export function LeadsClient({
  rows, paging, card, closed, rangeLabel, people, canExport, views, summary, stages, dealStages, sources, users, canCreate, scopeIsAll, openId, extraColumns,
}: Props) {
  const list = useListParams();
  const filter = card;
  const [formOpen, setFormOpen] = useState(false);
  const [cardScan, setCardScan] = useState<{ data: VisitingCardScan; photo: Blob | null } | null>(null);

  // Arrived from the header scanner with a visiting card read: open the form filled in.
  useEffect(() => {
    if (!canCreate) return;
    const h = takeHandoff('visiting_card');
    if (h) { setCardScan({ data: h.result.data, photo: h.photo }); setFormOpen(true); }
  }, [canCreate]);
  // Seeded from ?open= so a link from a quotation lands on the lead itself
  // rather than on an unfiltered list of every lead, which is barely better
  // than not linking at all.
  const [openLeadId, setOpenLeadId] = useState<string | null>(openId ?? null);

  // Order matches the original exactly - 02-leads.md §1.2
  const cards: KpiCard[] = [
    { key: 'new', label: 'New Leads', count: summary.new, icon: 'sparkles', tone: 'brand' },
    { key: 'unassigned', label: 'Unassigned', count: summary.unassigned, icon: 'user', tone: 'warning' },
    { key: 'contacted', label: 'Contacted', count: summary.contacted, icon: 'phone' },
    { key: 'in_progress', label: 'In Progress', count: summary.in_progress, icon: 'trending-up' },
    { key: 'meeting', label: 'Meeting', count: summary.meeting, icon: 'calendar' },
    { key: 'due_today', label: 'Due Today', count: summary.due_today, icon: 'clock', tone: 'warning' },
    { key: 'assigned_today', label: 'Assigned Today', count: summary.assigned_today, icon: 'user-plus' },
    { key: 'over_due', label: 'Over Due', count: summary.over_due, icon: 'alert-triangle', tone: 'danger' },
    { key: 'all', label: 'All Leads', count: summary.all, icon: 'users',
      subLabel: formatCurrencyCompact(summary.open_potential_paise) },
    { key: 'closed', label: 'Closed Leads', count: summary.closed, icon: 'lock' },
    { key: 'converted', label: 'Converted', count: summary.converted, icon: 'check-circle',
      subLabel: formatCurrencyCompact(summary.won_potential_paise), tone: 'success' },
  ];

  // The Active/Closed toggle and a closed-only card are resolved on the server
  // (server/leads-list), so they can never ask for a lead both open and closed.
  const showingClosed = closed;

  const columns: Column<LeadRow>[] = [
    { key: 'leadCode', header: 'Code', width: '7rem',
      render: (r) => <button type="button" onClick={() => setOpenLeadId(r.id)} className="font-mono text-xs font-medium text-brand hover:underline">{r.leadCode}</button>,
      sortValue: (r) => r.leadCode },
    { key: 'businessName', header: 'Business',
      render: (r) => r.businessName ?? <span className="text-muted-foreground">-</span>,
      sortValue: (r) => r.businessName },
    { key: 'displayName', header: 'Name',
      render: (r) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          {r.requirement && (
            <p className="max-w-xs truncate text-xs text-muted-foreground">{r.requirement}</p>
          )}
        </div>
      ),
      sortValue: (r) => r.displayName },
    { key: 'mobile', header: 'Mobile',
      render: (r) => <span className="font-mono text-xs">{r.mobile}</span>,
      sortValue: (r) => r.mobile },
    { key: 'stageName', header: 'Stage',
      render: (r) => r.stageName ? <Badge>{r.stageName}</Badge> : '-',
      sortValue: (r) => r.stageName },
    { key: 'dealStageName', header: 'Deal',
      render: (r) => r.dealStageName
        ? <Badge tone={DEAL_TONE[r.dealStageName] ?? 'neutral'}>{r.dealStageName}</Badge>
        : '-',
      sortValue: (r) => r.dealStageName },
    { key: 'potential', header: 'Potential', align: 'end',
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.potentialPaise)}</span>,
      sortValue: (r) => r.potentialPaise },
    { key: 'assignedToName', header: 'Assigned To',
      render: (r) => r.assignedToName
        ?? <Badge tone="warning" icon="user">Unassigned</Badge>,
      sortValue: (r) => r.assignedToName },
    { key: 'nextActionAt', header: 'Next Action',
      render: (r) => {
        if (!r.nextActionAt) return '-';
        const overdue = new Date(r.nextActionAt) < new Date()
          && new Date(r.nextActionAt).toDateString() !== new Date().toDateString();
        return <span className={`text-xs ${overdue ? 'text-danger' : ''}`}>{fmtDate(r.nextActionAt)}</span>;
      },
      sortValue: (r) => r.nextActionAt?.getTime() ?? null },
    { key: 'converted', header: 'Converted',
      render: (r) => r.convertedCustomerId
        ? (
          <Link
            href="/customers"
            className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-on-tint-success transition hover:bg-success/20"
          >
            <Icon name="users" className="h-3 w-3" />
            Customer
            <Icon name="arrow-up-right" className="h-3 w-3" />
          </Link>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
      sortValue: (r) => (r.convertedCustomerId ? 1 : 0) },
    { key: 'sourceName', header: 'Source', render: (r) => r.sourceName ?? '-',
      sortValue: (r) => r.sourceName, optional: true },
    { key: 'city', header: 'City', render: (r) => r.city ?? '-', sortValue: (r) => r.city, optional: true },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '-', sortValue: (r) => r.email, optional: true },
    { key: 'lastTalkAt', header: 'Last Talk', render: (r) => fmtDate(r.lastTalkAt),
      sortValue: (r) => r.lastTalkAt?.getTime() ?? null, optional: true },
    { key: 'sinceDate', header: 'Since', render: (r) => fmtDate(r.sinceDate),
      sortValue: (r) => r.sinceDate.getTime(), optional: true },
    { key: 'tags', header: 'Tags',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.tags.map((t) => <Badge key={t} tone="navy">{t}</Badge>)}
          {r.tags.length === 0 && <span className="text-muted-foreground">-</span>}
        </div>
      ),
      optional: true },
  ];

  return (
    <div>
      <PageHeader
        badge="LD"
        title="Leads"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{summary.all} open</span>
            <span className="text-border-strong">·</span>
            <span>{formatCurrencyCompact(summary.open_potential_paise)} potential</span>
            {summary.converted > 0 && (
              <>
                <span className="text-border-strong">·</span>
                <span className="font-medium text-success">{summary.converted} converted</span>
              </>
            )}
          </span>
        }
        actions={
          <Button
            variant="primary"
            icon="user-plus"
            disabled={!canCreate}
            title={scopeIsAll ? 'Select a single store to add a lead' : undefined}
            onClick={() => setFormOpen(true)}
          >
            Add Lead
          </Button>
        }
      />

      <FilterBar
        searchPlaceholder="Lead code, name, business, mobile, email, city, requirement…"
        dates={{ defaultPreset: 'all', label: 'Since', activeLabel: rangeLabel }}
        people={{ label: 'Assigned to', options: people }}
        extra={
          <ToggleChip
            on={!showingClosed}
            label="Active"
            offLabel="Closed"
            onChange={() => list.set({ view: showingClosed ? null : 'closed', card: filterImpliesClosed(filter) ? null : filter })}
          />
        }
        shown={paging.total}
        clearKeys={['card', 'view']}
        exportScreen={canExport ? 'leads' : null}
        views={views}
      />

      <KpiStrip cards={cards} activeKey={filter} onSelect={(k) => list.set({ card: k })} columns={6} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={[...columns, ...customColumns<LeadRow>(extraColumns)]}
        rowKey={(r) => r.id}
        quickActions={(r) => contactActions(r.mobile)}
        mobileCard={(r) => (
          <button type="button" onClick={() => setOpenLeadId(r.id)} className="block w-full text-start">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.leadCode}</span>
              {r.stageName && <Badge>{r.stageName}</Badge>}
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.displayName}{r.businessName ? ` · ${r.businessName}` : ''}</p>
            <p className="text-xs text-muted-foreground">
              {r.mobile} · {r.assignedToName ?? 'Unassigned'}{r.nextActionAt ? ` · next ${fmtDate(r.nextActionAt)}` : ''}
            </p>
          </button>
        )}
        emptyIcon="user-plus"
        emptyMessage={filter ? 'No leads match this card.' : `No ${showingClosed ? 'closed' : 'open'} leads.`}
        emptyHint={
          filter
            ? 'Clear the card to see every lead.'
            : 'Add one from the button above. Calls, WhatsApp messages and notes are all logged against the lead.'
        }
        /* Inherits the shared sizes - this list holds every lead now. */
        actions={[
          { label: 'Open', icon: 'eye', onSelect: (r) => setOpenLeadId(r.id) },
          {
            label: 'Call', icon: 'phone', separatorBefore: true,
            onSelect: (r) => window.open(`tel:${r.mobile.replace(/\s/g, '')}`),
          },
          {
            label: 'WhatsApp', icon: 'whatsapp', tone: 'success',
            onSelect: (r) => window.open(whatsappLink(r.mobile, ''), '_blank'),
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Converted leads live under <strong>Closed Leads</strong> and{' '}
          <strong>Converted</strong> - a converted lead is closed by definition,
          so it is not in the Active view. Bulk upload (A045), the twelve
          settings tabs (A047) and rule-based assignment (A048) are not built
          yet.
        </span>
      </p>

      {openLeadId && (
        <LeadDrawer
          leadId={openLeadId}
          stages={stages}
          dealStages={dealStages}
          users={users}
          onClose={() => setOpenLeadId(null)}
        />
      )}

      {formOpen && (
        <LeadForm
          stages={stages}
          dealStages={dealStages}
          sources={sources}
          users={users}
          initialCard={cardScan}
          onClose={() => { setFormOpen(false); setCardScan(null); }}
        />
      )}
    </div>
  );
}
