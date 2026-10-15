'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, Card, EmptyState, Field, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { Icon } from '@/components/ui/Icon';
import { GroupedBars } from '@/components/ui/Chart';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { PeriodType } from '@/lib/target-period';
import type { TargetRow } from '@/server/targets';
import { saveTarget, deleteTarget } from './actions';
import { initials } from '@/lib/revenue';
import { ask } from '@/components/ui/ask';

interface SerialPeriod {
  type: PeriodType;
  label: string;
  startIso: string;
  endIso: string;
}

interface View {
  fy: number;
  rows: TargetRow[];
  periods: SerialPeriod[];
  totals: {
    targetPaise: number;
    achievedPaise: number;
    achievementPct: number | null;
    incentivePaise: number;
  };
}

const TABS = [
  { key: 'all', label: 'All Targets', icon: 'menu' },
  { key: 'manage', label: 'Manage Targets', icon: 'sliders' },
  { key: 'report', label: 'Report', icon: 'bar-chart' },
] as const;

type TabKey = typeof TABS[number]['key'];

export function SalesTargetClient({
  view, monthly, canEdit, scopeIsAll,
}: {
  view: View;
  monthly: { label: string; targetPaise: number; achievedPaise: number }[];
  canEdit: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<TargetRow | null>(null);
  const [busy, setBusy] = useState(false);

  const current = view.rows[0];
  const periodLabel = current?.periodLabel ?? 'This period';

  const withTarget = view.rows.filter((r) => r.targetPaise > 0);
  const onTrack = withTarget.filter((r) => (r.achievementPct ?? 0) >= 100).length;
  const behind = withTarget.length - onTrack;

  const cards: KpiCard[] = [
    { key: 'records', label: 'Total Records', count: view.rows.length, icon: 'users' },
    {
      key: 'target', label: 'Total Target', icon: 'pie-chart', tone: 'navy',
      count: formatCurrencyCompact(view.totals.targetPaise),
      subLabel: withTarget.length === 0 ? 'none set' : `${withTarget.length} set`,
    },
    {
      key: 'achieved', label: 'Total Achieved', icon: 'trending-up', tone: 'success',
      count: formatCurrencyCompact(view.totals.achievedPaise),
    },
    {
      key: 'overall', label: 'Overall Achievement', icon: 'bar-chart',
      count: view.totals.achievementPct === null
        ? '-'
        : `${view.totals.achievementPct.toFixed(0)}%`,
      subLabel: view.totals.achievementPct === null ? 'no target set' : undefined,
      tone: view.totals.achievementPct === null
        ? 'default'
        : view.totals.achievementPct >= 100 ? 'success' : 'warning',
    },
    { key: 'on_track', label: 'On Target', count: onTrack, icon: 'check-circle', tone: 'success' },
    { key: 'behind', label: 'Behind', count: behind, icon: 'alert-triangle', tone: 'warning' },
    {
      key: 'incentive', label: 'Incentive Earned', icon: 'credit-card', tone: 'brand',
      count: formatCurrencyCompact(view.totals.incentivePaise),
    },
    {
      key: 'no_target', label: 'No Target Set', icon: 'user',
      count: view.rows.length - withTarget.length,
      tone: view.rows.length - withTarget.length > 0 ? 'warning' : 'default',
    },
  ];

  const visible = view.rows.filter((r) => {
    if (filter === 'on_track') return r.targetPaise > 0 && (r.achievementPct ?? 0) >= 100;
    if (filter === 'behind') return r.targetPaise > 0 && (r.achievementPct ?? 0) < 100;
    if (filter === 'no_target') return r.targetPaise === 0;
    return true;
  });

  const columns: Column<TargetRow>[] = [
    { key: 'name', header: 'Employee',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
            {initials(r.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-xs text-muted-foreground">@{r.username}</p>
          </div>
        </div>
      ),
      sortValue: (r) => r.name },
    { key: 'period', header: 'Period',
      render: (r) => <Badge tone="neutral">{r.periodLabel}</Badge> },
    { key: 'target', header: 'Target', align: 'end',
      render: (r) => r.targetPaise > 0
        ? <span className="font-mono text-xs tabular-nums">{formatCurrency(r.targetPaise)}</span>
        : <span className="text-xs text-muted-foreground">Not set</span>,
      sortValue: (r) => r.targetPaise },
    { key: 'achieved', header: 'Achieved', align: 'end',
      render: (r) => (
        <div className="text-end">
          <span className="font-mono text-xs font-semibold tabular-nums text-success">
            {formatCurrency(r.achievedPaise)}
          </span>
          <p className="text-xs text-muted-foreground">
            {r.orderCount} order{r.orderCount === 1 ? '' : 's'}
          </p>
        </div>
      ),
      sortValue: (r) => r.achievedPaise },
    { key: 'progress', header: 'Achievement', width: '12rem',
      render: (r) => {
        if (r.achievementPct === null) {
          return <span className="text-xs text-muted-foreground">Set a target to track</span>;
        }
        const pct = r.achievementPct;
        return (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : pct >= 60 ? 'bg-brand' : 'bg-warning'}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className={`mt-1 text-xs font-medium tabular-nums ${pct >= 100 ? 'text-success' : 'text-muted-foreground'}`}>
              {pct.toFixed(0)}%
            </p>
          </div>
        );
      },
      sortValue: (r) => r.achievementPct ?? -1 },
    { key: 'gap', header: 'Gap', align: 'end',
      render: (r) => {
        if (r.targetPaise === 0) return <span className="text-muted-foreground">-</span>;
        return (
          <span className={`font-mono text-xs tabular-nums ${r.gapPaise > 0 ? 'text-danger' : 'text-success'}`}>
            {formatCurrency(Math.abs(r.gapPaise))} {r.gapPaise > 0 ? 'short' : 'over'}
          </span>
        );
      },
      sortValue: (r) => r.gapPaise },
    { key: 'incentive', header: 'Incentive', align: 'end',
      render: (r) => r.incentivePct > 0
        ? (
          <div className="text-end">
            <span className="font-mono text-xs font-semibold tabular-nums text-brand">
              {formatCurrency(r.incentivePaise)}
            </span>
            <p className="text-xs text-muted-foreground">@ {r.incentivePct}%</p>
          </div>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
      sortValue: (r) => r.incentivePaise },
  ];

  const changePeriod = (p: SerialPeriod) => {
    router.push(`/settings/user-target?period=${p.type}&start=${p.startIso}`);
  };

  return (
    <div>
      <PageHeader
        badge="ST"
        title="Sales Target"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{periodLabel}</span>
            <span className="text-border-strong">·</span>
            <span>{view.rows.length} employee{view.rows.length === 1 ? '' : 's'}</span>
            <span className="text-border-strong">·</span>
            <span className="font-medium text-success">
              {formatCurrencyCompact(view.totals.achievedPaise)} achieved
            </span>
          </span>
        }
        actions={
          <>
            <select
              value={`${current?.periodType ?? 'fy'}|${current?.periodStart ?? ''}`}
              onChange={(e) => {
                const [type, startIso] = e.target.value.split('|');
                const p = view.periods.find(
                  (x) => x.type === type && x.startIso === startIso,
                ) ?? view.periods[0];
                changePeriod(p);
              }}
              className="h-9 rounded border border-border bg-card px-2 text-sm outline-none focus:border-brand"
            >
              {view.periods.map((p) => (
                <option key={`${p.type}|${p.startIso}`} value={`${p.type}|${p.startIso}`}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              variant="primary" icon="plus" disabled={!canEdit}
              title={scopeIsAll ? 'Select a single store first' : undefined}
              onClick={() => setEditing(view.rows[0] ?? null)}
            >
              Set Target
            </Button>
          </>
        }
      />

      <div className="thin-scroll mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'all' && (
        <>
          <Toolbar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Employee name…"
            count={`Total (${visible.length})`}
            end={
              <>
                <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
                <ToolbarIcon
                  icon="x-circle" label="Clear filters"
                  active={filter !== null || search !== ''}
                  onClick={() => { setFilter(null); setSearch(''); }}
                />
              </>
            }
          />

          <KpiStrip cards={cards} activeKey={filter} onSelect={setFilter} columns={8} />

          <DataGrid
            rows={visible}
            columns={columns}
            rowKey={(r) => r.userId}
            search={search}
            emptyIcon="users"
            emptyMessage="No Rows To Show"
            emptyHint="Employees appear here once they hold a role in this store."
            pageSizes={[10, 25, 50]}
            pageSummary={(pageRows) => (
              <>
                <span className="text-muted-foreground">
                  Page Target:{' '}
                  <strong className="font-mono text-foreground">
                    {formatCurrency(pageRows.reduce((n, r) => n + r.targetPaise, 0))}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  Page Achieved:{' '}
                  <strong className="font-mono text-success">
                    {formatCurrency(pageRows.reduce((n, r) => n + r.achievedPaise, 0))}
                  </strong>
                </span>
              </>
            )}
            actions={[
              {
                label: 'Set target', icon: 'pie-chart',
                enabled: () => canEdit,
                onSelect: (r) => setEditing(r),
              },
              {
                label: 'View orders', icon: 'shopping-cart', separatorBefore: true,
                onSelect: () => { window.location.href = '/sales/orders'; },
              },
              {
                label: 'Remove target', icon: 'trash', tone: 'danger', separatorBefore: true,
                enabled: (r) => canEdit && r.id !== null,
                onSelect: async (r) => {
                  if (!r.id) return;
                  if (!(await ask.confirm({
                    tone: 'danger', icon: 'trash',
                    title: `Remove ${r.name}'s target?`,
                    message: `The target for ${r.periodLabel} is removed. Sales already made are not touched.`,
                    confirmLabel: 'Remove target', cancelLabel: 'Keep it',
                  }))) return;
                  setBusy(true);
                  const res = await deleteTarget(r.id);
                  setBusy(false);
                  if (res.error) await ask.error(res.error);
                  else window.location.reload();
                },
              },
            ]}
          />
        </>
      )}

      {tab === 'manage' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SectionCard title="Set a target" icon="pie-chart">
            <p className="mb-3 text-sm text-muted-foreground">
              Pick a person from the list below to set their target for{' '}
              <strong className="text-foreground">{periodLabel}</strong>. Change
              the period from the selector at the top of the page.
            </p>
            <ul className="divide-y divide-border">
              {view.rows.map((r) => (
                <li key={r.userId} className="flex items-center gap-3 py-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
                    {initials(r.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {r.targetPaise > 0 ? formatCurrency(r.targetPaise) : 'Not set'}
                  </span>
                  <Button
                    size="sm" variant="outline" icon="pencil" disabled={!canEdit}
                    onClick={() => setEditing(r)}
                  >
                    {r.targetPaise > 0 ? 'Edit' : 'Set'}
                  </Button>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="How targets work" icon="info">
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                A target belongs to a <strong>person, a store and a period</strong>.
                The same sheet holds monthly, quarterly and financial-year
                targets - pick the period at the top.
              </p>
              <p>
                Quarters follow the <strong>financial year</strong>: Q1 is
                April–June, not January–March. Getting that wrong is the most
                common reporting bug in Indian software, so it is pinned down by
                tests rather than trusted.
              </p>
              <p>
                <strong>Achievement is never stored.</strong> It is the sum of
                that person&rsquo;s orders in the period, computed each time you
                look - a stored figure goes stale the moment an order is
                cancelled, and nobody remembers to recompute it.
              </p>
              <p>
                Cancelled and failed orders do not count towards anyone&rsquo;s
                number.
              </p>
              <p>
                <strong>Incentive is paid on what was achieved</strong>, not on
                the target. Below target still earns - the target is a goal, not
                a gate.
              </p>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === 'report' && (
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Icon name="bar-chart" className="h-4 w-4 text-brand" />
            Monthly target vs achievement
            <Badge tone="neutral" className="ms-auto">FY {view.fy}-{String((view.fy + 1) % 100).padStart(2, '0')}</Badge>
          </h2>

          {monthly.every((m) => m.targetPaise === 0 && m.achievedPaise === 0) ? (
            <EmptyState
              icon="bar-chart"
              title="Nothing to compare yet"
              hint="Set monthly targets and record some orders, and this fills in."
              action={
                <Button variant="outline" icon="sliders" onClick={() => setTab('manage')}>
                  Set targets
                </Button>
              }
            />
          ) : (
            <GroupedBars
              points={monthly.map((m) => ({
                label: m.label.split(' ')[0],
                values: [m.targetPaise, m.achievedPaise],
              }))}
              series={[
                { label: 'Target', tone: 'navy' },
                { label: 'Achieved', tone: 'success' },
              ]}
            />
          )}
        </Card>
      )}

      {editing && (
        <TargetDialog
          row={editing}
          periods={view.periods}
          people={view.rows}
          onClose={() => setEditing(null)}
        />
      )}

      {busy && (
        <div role="status" aria-label="Loading" className="fixed inset-0 z-[300] grid place-items-center bg-navy/20">
          <span className="rounded-lg bg-card px-4 py-2 text-sm shadow-overlay">Working…</span>
        </div>
      )}
    </div>
  );
}

function TargetDialog({
  row, periods, people, onClose,
}: {
  row: TargetRow;
  periods: SerialPeriod[];
  people: TargetRow[];
  onClose: () => void;
}) {
  const [userId, setUserId] = useState(row.userId);
  const [periodKey, setPeriodKey] = useState(
    `${row.periodType}|${row.periodStart ? new Date(row.periodStart).toISOString() : ''}`,
  );
  const [target, setTarget] = useState(row.targetPaise / 100);
  const [incentive, setIncentive] = useState(row.incentivePct);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const period =
    periods.find((p) => `${p.type}|${p.startIso}` === periodKey) ?? periods[0];
  const person = people.find((p) => p.userId === userId);

  const submit = async () => {
    setError(null);
    setSaving(true);
    const r = await saveTarget({
      userId,
      periodType: period.type,
      periodStartIso: period.startIso,
      periodEndIso: period.endIso,
      periodLabel: period.label,
      targetRupees: target,
      incentivePct: incentive,
      note,
    });
    setSaving(false);
    if (r.error) { setError(r.error); return; }
    if (r.message) await ask.tell(r.message);
    onClose();
    window.location.reload();
  };

  return (
    <Modal
      title="Set Target"
      subtitle={`${person?.name ?? 'Employee'} · ${period.label}`}
      icon="pie-chart"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="outline" icon="x" onClick={onClose} className="ms-auto">Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={saving}>
            Save target
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Employee" required>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="field-input"
          >
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>{p.name} (@{p.username})</option>
            ))}
          </select>
        </Field>

        <Field
          label="Period"
          required
          hint="Quarters follow the financial year - Q1 is April to June."
        >
          <select
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="field-input"
          >
            {periods.map((p) => (
              <option key={`${p.type}|${p.startIso}`} value={`${p.type}|${p.startIso}`}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Target" required>
          <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
            <span className="ps-3 text-sm text-muted-foreground">₹</span>
            <input
              type="number" min={0} step={1000} value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="w-full bg-transparent px-2 py-2 text-sm outline-none"
            />
          </div>
        </Field>

        <Field
          label="Incentive %"
          hint="Paid on what was achieved, not on the target. Zero means no incentive."
        >
          <input
            type="number" min={0} max={100} step={0.25} value={incentive}
            onChange={(e) => setIncentive(Number(e.target.value))}
            className="field-input"
          />
        </Field>

        {person && person.achievedPaise > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-xs text-on-tint-success">
            <Icon name="trending-up" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {person.name} has already done{' '}
              <strong>{formatCurrency(person.achievedPaise)}</strong> in this
              period across {person.orderCount} order
              {person.orderCount === 1 ? '' : 's'}.
              {target > 0 && (
                <> That is {((person.achievedPaise / (target * 100)) * 100).toFixed(0)}% of this target.</>
              )}
            </span>
          </p>
        )}

        <Field label="Note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this number, if it is worth remembering"
            className="field-input"
          />
        </Field>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
