'use client';
import { useTreeSearch } from '@/components/ui/TreeSearch';

import { type ReactNode, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import Link from 'next/link';
import { initials } from '@/lib/revenue';
import { resolveAvatarClass } from '@/lib/avatar';
import { OrgChartTree } from '@/components/ui/OrgChartTree';
import type { OrgChart, OrgNode } from '@/server/hierarchy';
import { setManagerAction } from './actions';

/**
 * The org chart as an indented list, not a box diagram.
 *
 * A drawn chart looks better in a slide and is worse to use: it needs
 * horizontal scrolling by the third level, it is unreadable on a phone, and
 * assigning somebody's manager means dragging a box. An indented list scrolls
 * one way, works at any width, and puts the control that changes a reporting
 * line on the row it belongs to.
 */

export function HierarchyClient({
  chart, canEdit,
}: {
  chart: OrgChart;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'chart'>('list');


  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  const managerOptions = useMemo(
    () => [...chart.everyone].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [chart.everyone],
  );

  const treeSearch = useTreeSearch(
    useMemo(
      () => chart.everyone.map((p) => ({
        id: p.id,
        parentId: p.reportsToId,
        terms: [p.fullName, p.departmentName],
      })),
      [chart.everyone],
    ),
  );

  const setManager = (userId: string, managerId: string) => {
    startTransition(async () => {
      const res = await setManagerAction(userId, managerId || null);
      report(res);
      if (!res.error) router.refresh();
    });
  };

  const renderNode = (n: OrgNode, depth: number): ReactNode => {
    /**
     * Hidden unless this node is being kept (F1b / D17).
     *
     * The previous rule hid any row whose own name did not match, which
     * stranded every hit: searching a technician hid the manager above them,
     * so the match appeared at the top of a chain that was no longer drawn and
     * you could not see where the person sat. `useTreeSearch` keeps a match's
     * ANCESTORS as well, and their reports, so the path survives.
     */
    const hidden = treeSearch.keep !== null && !treeSearch.keep.has(n.id);

    return (
      <div key={n.id} className={depth > 0 ? 'border-s-2 border-border/70' : ''} style={depth > 0 ? { marginInlineStart: '1.35rem' } : undefined}>
        {!hidden && (
          <div className="group flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 transition hover:bg-muted/30">
            {depth > 0 && (
              <span className="-ms-[1.35rem] h-px w-4 shrink-0 border-t-2 border-border/70" aria-hidden />
            )}

            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${resolveAvatarClass(n.id, n.avatarColor)}`}
              aria-hidden
            >
              {initials(n.fullName)}
            </span>

            <div className="min-w-[9rem] flex-1 basis-40">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                {n.fullName}
                {n.designationCode && <Badge tone="neutral">{n.designationCode}</Badge>}
                {!n.isActive && <Badge tone="neutral">Inactive</Badge>}
                {n.headcount > 0 && (
                  <Badge tone="info" icon="users">{n.headcount} report{n.headcount === 1 ? '' : 's'}</Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {n.departmentName ?? 'No department'}
                {n.roleNames.length > 0 ? ` · ${n.roleNames.join(', ')}` : ''}
              </span>
            </div>

            <select
              disabled={!canEdit || pending}
              value={n.reportsToId ?? ''}
              onChange={(e) => setManager(n.id, e.target.value)}
              aria-label={`Who ${n.fullName} reports to`}
              className="h-8 w-full basis-full rounded-lg border border-border bg-card px-2 text-xs outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 group-hover:border-muted-foreground/40 sm:basis-auto sm:max-w-[14rem]"
            >
              <option value="">Reports to nobody</option>
              {managerOptions
                .filter((m) => m.id !== n.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.fullName}</option>
                ))}
            </select>
          </div>
        )}
        {n.reports.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const stats = useMemo(() => {
    const departments = new Set(chart.everyone.map((p) => p.departmentName).filter(Boolean));
    return {
      people: chart.everyone.length,
      departments: departments.size,
      topLevel: chart.roots.length,
    };
  }, [chart.everyone, chart.roots.length]);

  return (
    <div>
      <PageHeader
        badge="HF"
        title="Hierarchy"
        subtitle="Who reports to whom"
        actions={
          <Link
            href="/hierarchy/team-setup"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition hover:bg-muted"
          >
            <Icon name="user-plus" className="h-4 w-4" />
            Team Setup
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: 'People', value: stats.people, icon: 'users' as const, tone: 'brand' as const },
          { label: 'Departments', value: stats.departments, icon: 'building' as const, tone: 'navy' as const },
          { label: 'Top level', value: stats.topLevel, icon: 'user' as const, tone: 'info' as const },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
              s.tone === 'brand' ? 'bg-brand/10 text-on-tint-brand'
                : s.tone === 'navy' ? 'bg-navy/10 text-on-tint-navy'
                : s.tone === 'info' ? 'bg-info/10 text-on-tint-info'
                : 'bg-success/10 text-on-tint-success'
            }`}>
              <Icon name={s.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">{s.value}</p>
              <p className="truncate text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Approvals moved out of this page on 5 Oct 2026 - see the comment on
          HierarchyPage. The reporting line drawn here still matters to them:
          leave, WFH and claims climb it. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
        <Icon name="check-circle" className="h-4 w-4 shrink-0 text-brand" />
        <span>
          Leave, WFH and claims go up the reporting line set here. Who approves what - orders, purchase
          orders, vouchers, challans, leave - is set in one place:
        </span>
        <Link href="/settings/approval-rules" className="font-medium text-brand hover:underline">
          Settings › Approval Rules
        </Link>
      </div>

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-on-tint-success">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {chart.roots.length > 1 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <strong>{chart.roots.length} people have no manager assigned</strong> - normal for exactly
              one (the owner), worth a look when there is more than one.
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chart.roots.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 ps-1 pe-2.5 text-xs">
                <span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold text-white ${resolveAvatarClass(r.id, r.avatarColor)}`}>
                  {initials(r.fullName)}
                </span>
                {r.fullName}
                <select
                  disabled={!canEdit || pending}
                  value=""
                  onChange={(e) => setManager(r.id, e.target.value)}
                  aria-label={`Set ${r.fullName}'s manager`}
                  className="h-6 rounded border border-border bg-card text-xs outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <option value="" disabled>Set manager…</option>
                  {managerOptions.filter((m) => m.id !== r.id).map((m) => (
                    <option key={m.id} value={m.id}>{m.fullName}</option>
                  ))}
                </select>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionCard
          title="Reporting line"
          icon="users"
          bodyClassName="p-0"
          action={
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {(['list', 'chart'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`h-7 rounded-md px-2.5 text-xs font-medium capitalize transition ${
                      view === v ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {view === 'list' && (
                <div className="flex items-center gap-2">
                  <div className="relative w-44">
                    <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={treeSearch.query}
                      onChange={(e) => treeSearch.setQuery(e.target.value)}
                      placeholder="Person or department…"
                      aria-label="Find a person or department"
                      className="h-8 w-full rounded-lg border border-border bg-card ps-8 pe-2 text-xs outline-none transition placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </div>
                  {treeSearch.query.trim() !== '' && (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span role="status">{treeSearch.matchCount} of {treeSearch.total} match</span>
                      <button type="button" onClick={() => treeSearch.setQuery('')} className="rounded px-1.5 py-0.5 text-brand hover:bg-brand/10">Clear</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          }
        >
          {chart.roots.length === 0 ? (
            <EmptyState icon="users" title="Nobody to show" hint="Add users before drawing a reporting line." />
          ) : view === 'chart' ? (
            <div className="p-4">
              <OrgChartTree roots={chart.roots} />
            </div>
          ) : (
            <div>{chart.roots.map((r) => renderNode(r, 0))}</div>
          )}

          <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Everybody with no manager appears at the top level. That is correct for the owner and
            wrong for everybody else, so a long top level usually means the chart is unfinished
            rather than flat. A person cannot report to themselves, or to somebody who already
            reports to them.
          </p>
        </SectionCard>

      </div>
    </div>
  );
}
