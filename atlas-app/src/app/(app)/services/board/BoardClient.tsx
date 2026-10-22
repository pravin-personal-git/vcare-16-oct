'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  CustomiseBar, CustomiseButton, StageChip, useCustomise, type Customise, type CustomiseProps,
} from '@/components/ui/PageCustomise';
import { CUSTOMISABLE_PAGES, isOverdue, paletteVar, visibleColumns } from '@/lib/page-customise';

/**
 * The Job Board, rebuilt. Pravin, 7 Oct 2026: "bahut ajeeb dikhta hai, ekdum
 * darawana aur overwhelming."
 *
 * Three things were wrong, and only one of them was the colour.
 *
 *  1. SIX COLUMNS OF EQUAL WIDTH, most of them empty. Half the screen was
 *     given to "Nothing here." Columns now size themselves: a column with
 *     cards is wide, an empty one shrinks to its heading.
 *
 *  2. EVERYTHING LATE WAS RED. When the common case is red, red stops meaning
 *     anything. Now only a MISSED deadline is red; "due soon" is a quiet
 *     amber, and the age of a job is left as a number, because "19d" says it
 *     without shouting.
 *
 *  3. NO WAY TO NARROW IT. Six columns and no filters is a wall. There is now
 *     a technician filter, a customer filter, a priority filter and a stage
 *     filter (Vcare, 22 Oct 2026), plus a
 *     list view for when the board has outgrown a board.
 *
 * Filtering is client-side on purpose: the page already holds every open job,
 * a shop has tens not thousands, and a round trip per keystroke would be
 * slower while buying nothing.
 */

export interface BoardJob {
  id: string;
  complaintNo: string;
  customerId: string;
  customerName: string;
  productName: string | null;
  description: string;
  status: string;
  statusLabel: string;
  priority: string;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  createdAtMs: number;
  /** 'missed' | 'near' | null, worked out on the server from the job's SLA. */
  mark: string | null;
  columnTitle: string;
}

const AGE = (ms: number) => {
  const h = Math.floor((Date.now() - ms) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** The list view's columns (page customisation can hide / reorder all but Job). */
const LIST_COLS = CUSTOMISABLE_PAGES['services.board'].columns;
type ListCol = (typeof LIST_COLS)[number];
const COL_TITLE: Record<ListCol, string> = { job: 'Job', customer: 'Customer', what: 'What', technician: 'Technician', stage: 'Stage', age: 'Open for' };

export function BoardClient({ jobs, columns, columnStatus, canSeeEveryone, customise }: {
  jobs: BoardJob[];
  columns: string[];
  /** The first status of each column - its colour is the column's dot. */
  columnStatus: Record<string, string>;
  /** Admins and managers get the per-technician and per-customer filters. */
  canSeeEveryone: boolean;
  /** Page customisation (11 Oct 2026, ops-pages demo tab 7). */
  customise: CustomiseProps;
}) {
  const c = useCustomise(customise);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const overdue = (j: BoardJob) => isOverdue(c.value, j.createdAtMs);
  const [tech, setTech] = useState('');
  const [customer, setCustomer] = useState('');
  const [priority, setPriority] = useState('');
  const [stage, setStage] = useState('');
  const [lateOnly, setLateOnly] = useState(false);

  const techs = useMemo(() => [...new Set(jobs
    .map((j) => j.assignedTechnicianName)
    .filter((n): n is string => !!n))].sort(), [jobs]);
  const customers = useMemo(() => [...new Set(jobs.map((j) => j.customerName))].sort(), [jobs]);
  /** Every stage an open job is in, under the branch's own name, in board order. */
  const stages = useMemo(() => {
    const seen = new Map<string, { label: string; col: number }>();
    for (const j of jobs) if (!seen.has(j.status)) seen.set(j.status, { label: j.statusLabel, col: columns.indexOf(j.columnTitle) });
    return [...seen].sort((a, b) => a[1].col - b[1].col || a[1].label.localeCompare(b[1].label));
  }, [jobs, columns]);

  const shown = useMemo(() => jobs.filter((j) => {
    if (tech === '__none') { if (j.assignedTechnicianName) return false; }
    else if (tech && j.assignedTechnicianName !== tech) return false;
    if (customer && j.customerName !== customer) return false;
    if (priority && j.priority !== priority) return false;
    if (stage && j.status !== stage) return false;
    if (lateOnly && j.mark !== 'missed') return false;
    return true;
  }), [jobs, tech, customer, priority, stage, lateOnly]);

  const filtering = !!(tech || customer || priority || stage || lateOnly);
  const late = jobs.filter((j) => j.mark === 'missed').length;
  const sel = 'h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand';

  return (
    <div>
      <PageHeader
        badge="JB"
        title="Jobs Dashboard"
        subtitle={`${shown.length} open${filtering ? ` of ${jobs.length}` : ''} · click one to open it`}
        actions={
          <div className="flex gap-1.5">
            <CustomiseButton c={c} />
            <Button size="sm" variant={view === 'grid' ? 'primary' : 'outline'} icon="grid" onClick={() => setView('grid')}>
              Board
            </Button>
            <Button size="sm" variant={view === 'list' ? 'primary' : 'outline'} icon="menu" onClick={() => setView('list')}>
              List
            </Button>
          </div>
        }
      />

      <CustomiseBar c={c} hint={view === 'grid' ? 'Switch to List to colour stages and arrange columns.' : 'Click a stage to colour it. Use the arrows on a heading to move or hide it.'} />

      {/* ---- filters ------------------------------------------------------ */}
      <Card className="mb-3 flex flex-wrap items-center gap-2 p-2.5">
        {canSeeEveryone && (
          <>
            <select value={tech} onChange={(e) => setTech(e.target.value)} className={sel} aria-label="Technician">
              <option value="">Every technician</option>
              <option value="__none">Nobody assigned</option>
              {techs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={sel} aria-label="Customer">
              <option value="">Every customer</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={sel} aria-label="Priority">
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={sel} aria-label="Stage">
          <option value="">Every stage</option>
          {stages.map(([status, s]) => <option key={status} value={status}>{s.label}</option>)}
        </select>

        {/*
          The one count worth a button. "Late" is the question somebody opens
          this screen to ask, and it is faster to press than to scan for.
        */}
        <Button
          size="sm"
          variant={lateOnly ? 'primary' : 'outline'}
          icon="alert-circle"
          onClick={() => setLateOnly(!lateOnly)}
          disabled={late === 0}
        >
          Past the deadline{late > 0 ? ` (${late})` : ''}
        </Button>

        {filtering && (
          <button
            type="button"
            onClick={() => { setTech(''); setCustomer(''); setPriority(''); setStage(''); setLateOnly(false); }}
            className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <Icon name="x" className="h-3 w-3" /> Clear filters
          </button>
        )}
      </Card>

      {shown.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={filtering ? 'Nothing matches' : 'No open jobs'}
          hint={filtering
            ? 'Clear the filters to see the rest of the board.'
            : 'Every job is closed. Older ones are on the Complaints Tracker.'}
        />
      ) : view === 'grid' ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {columns.map((title) => {
            const rows = shown
              .filter((j) => j.columnTitle === title)
              .sort((a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || a.createdAtMs - b.createdAtMs);
            return (
              <section
                key={title}
                /*
                  An empty column shrinks to its heading instead of holding a
                  288px rectangle that says "Nothing here." Six of those was
                  most of the screen.
                */
                className={`flex shrink-0 flex-col rounded-xl border border-border bg-muted/30 ${
                  rows.length === 0 ? 'w-40' : 'w-72'
                }`}
              >
                <h2 className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {c.value.colors[columnStatus[title]] && <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: paletteVar(c.value.colors[columnStatus[title]]) }} />}
                    <span className="truncate">{title}</span>
                  </span>
                  <span className="rounded-full bg-card px-2 tabular-nums text-muted-foreground">{rows.length}</span>
                </h2>
                <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                  {rows.length === 0 && (
                    <li className="px-1 py-1 text-micro text-muted-foreground">Empty</li>
                  )}
                  {rows.map((j) => <li key={j.id}><JobCard job={j} overdue={overdue(j)} /></li>)}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <ListTable jobs={shown} c={c} overdue={overdue} />
          </div>
          <p className="border-t border-border px-4 py-2 text-micro text-muted-foreground">
            Oldest first — the ones that have been waiting longest are at the top.
          </p>
        </Card>
      )}
    </div>
  );
}

function ListTable({ jobs, c, overdue }: { jobs: BoardJob[]; c: Customise; overdue: (j: BoardJob) => boolean }) {
  const cols = visibleColumns(LIST_COLS, c.value);
  // In customise mode the hidden columns stay listed (struck through) so they can come back.
  const heads = c.editing ? visibleColumns(LIST_COLS, { ...c.draft, hidden: [] }) : cols;
  const move = (k: ListCol, by: -1 | 1) => {
    const order = visibleColumns(LIST_COLS, { ...c.draft, hidden: [] });
    const i = order.indexOf(k);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    c.setDraft({ ...c.draft, order });
  };
  const toggle = (k: ListCol) => c.setDraft({ ...c.draft, hidden: c.draft.hidden.includes(k) ? c.draft.hidden.filter((x) => x !== k) : [...c.draft.hidden, k] });
  const cell = (k: ListCol, j: BoardJob) => {
    switch (k) {
      case 'job': return (
        <td key={k} className="px-4 py-2">
          <Link href={`/services/complaints/${j.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{j.complaintNo}</Link>
          {(j.mark === 'missed' || overdue(j)) && <Badge tone="danger" className="ms-2">Overdue</Badge>}
        </td>
      );
      case 'customer': return <td key={k} className="px-3 py-2"><CustomerLink id={j.customerId}>{j.customerName}</CustomerLink></td>;
      case 'what': return <td key={k} className="max-w-[260px] truncate px-3 py-2 text-muted-foreground">{j.productName ?? j.description}</td>;
      case 'technician': return <td key={k} className="px-3 py-2">{j.assignedTechnicianName ?? <span className="text-muted-foreground">Nobody</span>}</td>;
      case 'stage': return <td key={k} className="px-3 py-2"><StageChip c={c} value={j.status} label={j.statusLabel} /></td>;
      case 'age': return <td key={k} className="px-3 py-2 text-end font-mono tabular-nums">{AGE(j.createdAtMs)}</td>;
    }
  };
  return (
    <table className="w-full min-w-[720px] text-xs">
      <thead>
        <tr className="border-b border-border text-micro uppercase text-muted-foreground">
          {heads.map((k, i) => {
            const off = c.editing && c.draft.hidden.includes(k);
            return (
              <th key={k} className={`py-2 font-semibold ${i === 0 ? 'px-4' : 'px-3'} ${k === 'age' ? 'text-end' : 'text-start'}`}>
                <span className={off ? 'line-through opacity-50' : ''}>{COL_TITLE[k]}</span>
                {c.editing && (
                  <span className="ms-1 inline-flex items-center gap-0.5 align-middle normal-case">
                    <button type="button" aria-label={`Move ${COL_TITLE[k]} left`} disabled={i === 0} onClick={() => move(k, -1)} className="rounded p-0.5 hover:bg-muted disabled:opacity-30"><Icon name="chevron-left" className="h-3 w-3" /></button>
                    <button type="button" aria-label={`Move ${COL_TITLE[k]} right`} disabled={i === heads.length - 1} onClick={() => move(k, 1)} className="rounded p-0.5 hover:bg-muted disabled:opacity-30"><Icon name="chevron-right" className="h-3 w-3" /></button>
                    {k !== 'job' && (
                      <button type="button" aria-label={off ? `Show ${COL_TITLE[k]}` : `Hide ${COL_TITLE[k]}`} onClick={() => toggle(k)} className="rounded p-0.5 hover:bg-muted">
                        <Icon name={off ? 'eye-off' : 'eye'} className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {[...jobs]
          .sort((a, b) => a.createdAtMs - b.createdAtMs)
          .map((j) => (
            <tr key={j.id} className={`border-b border-border/60 last:border-0 ${overdue(j) ? 'bg-danger/5 hover:bg-danger/10' : 'hover:bg-muted/40'}`}>
              {cols.map((k) => cell(k, j))}
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function JobCard({ job: j, overdue = false }: { job: BoardJob; overdue?: boolean }) {
  return (
    <Link
      href={`/services/complaints/${j.id}`}
      /*
        Only a MISSED deadline gets a coloured edge. "Due soon" and a high
        priority are said in words on the card - if everything has a red
        border, a red border tells you nothing.
      */
      className={`block rounded-lg border bg-card p-2.5 transition hover:border-brand ${
        j.mark === 'missed' || overdue ? 'border-danger' : 'border-border'
      }`}
    >
      <p className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{j.complaintNo}</span>
        <span className="text-xs text-muted-foreground">{AGE(j.createdAtMs)}</span>
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{j.customerName}</p>
      <p className="truncate text-xs text-muted-foreground">{j.productName ?? j.description}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{j.assignedTechnicianName ?? 'No technician'}</span>
        {(j.priority === 'urgent' || j.priority === 'high') && (
          <Badge tone={j.priority === 'urgent' ? 'danger' : 'warning'}>{j.priority}</Badge>
        )}
        {(j.mark === 'missed' || overdue) && <Badge tone="danger">Overdue</Badge>}
        {j.mark === 'near' && !overdue && <Badge tone="warning">Due soon</Badge>}
      </p>
    </Link>
  );
}
