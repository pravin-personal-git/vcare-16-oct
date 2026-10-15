'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, EmptyState, PageHeader, Segmented } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { ChecklistDayRow, ChecklistItemRow, ChecklistMonthRow } from '@/server/staff-checklist';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { saveChecklistAction, addItemAction, updateItemAction } from './actions';

type Tab = 'day' | 'month' | 'points';
const field = 'h-9 rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function ChecklistClient({ scopeIsAll, day, month, tab, items, rows, monthRows, canEdit, today, canExport, views }: {
  scopeIsAll: boolean; day: string; month: string; tab: Tab; items: ChecklistItemRow[];
  rows: ChecklistDayRow[]; monthRows: ChecklistMonthRow[]; canEdit: boolean; today: string;
  canExport: boolean; views: FilterBarViews;
}) {
  const router = useRouter();
  const go = (p: Record<string, string>) => {
    // Keeps the person search while moving between days, months and tabs.
    const cur = new URLSearchParams(window.location.search);
    const q = new URLSearchParams({ tab, d: day, m: month, ...(cur.get('q') ? { q: cur.get('q')! } : {}), ...p });
    router.push(`/attendance/checklist?${q.toString()}`);
  };

  return (
    <div>
      <PageHeader
        badge="calendar"
        title="Daily Checklist"
        subtitle="The points each person is checked on every day: present, on time, dress code and your own"
        actions={<Segmented value={tab} onChange={(v) => go({ tab: v })} options={[
          { value: 'day', label: 'Day' }, { value: 'month', label: 'Month summary' },
          ...(canEdit ? [{ value: 'points' as const, label: 'Points' }] : []),
        ]} />}
      />
      {!scopeIsAll && tab !== 'points' && (
        <FilterBar
          searchPlaceholder="Person or department…"
          shown={tab === 'day' ? rows.length : monthRows.length}
          exportScreen={canExport ? 'checklist' : null}
          views={views}
        />
      )}
      {scopeIsAll ? (
        <Card className="border-warning/40 bg-warning/10 p-3"><p className="text-sm">Select a single branch to see its checklist.</p></Card>
      ) : tab === 'day' ? (
        <DayView day={day} today={today} items={items} rows={rows} canEdit={canEdit} onDay={(d) => go({ d })} />
      ) : tab === 'month' ? (
        <MonthView month={month} items={items} rows={monthRows} onMonth={(m) => go({ m })} />
      ) : (
        <PointsView items={items} />
      )}
    </div>
  );
}

function DayView({ day, today, items, rows, canEdit, onDay }: {
  day: string; today: string; items: ChecklistItemRow[]; rows: ChecklistDayRow[]; canEdit: boolean; onDay: (d: string) => void;
}) {
  const [state, setState] = useState(rows);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setState(rows), [rows]);

  const save = (row: ChecklistDayRow, values: Record<string, boolean>) => {
    setSavingId(row.userId); setError(null);
    setState((s) => s.map((r) => (r.userId === row.userId ? { ...r, values, suggested: false } : r)));
    start(async () => {
      const res = await saveChecklistAction(row.userId, day, values, row.note);
      if (res.error) setError(res.error);
      setSavingId(null);
    });
  };
  const confirmSuggested = () => {
    const todo = state.filter((r) => r.suggested);
    setError(null);
    start(async () => {
      for (const r of todo) {
        const res = await saveChecklistAction(r.userId, day, r.values, null);
        if (res.error) { setError(res.error); break; }
      }
      setState((s) => s.map((r) => ({ ...r, suggested: false })));
    });
  };
  const suggestedCount = state.filter((r) => r.suggested).length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ck-day" className="text-sm text-muted-foreground">Day</label>
        <input id="ck-day" type="date" value={day} max={today} onChange={(e) => e.target.value && onDay(e.target.value)} className={field} />
        {canEdit && suggestedCount > 0 && (
          <Button size="sm" icon="check" loading={pending && !savingId} onClick={confirmSuggested}>
            Save {suggestedCount} unmarked as shown
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Unmarked rows show &ldquo;Present&rdquo; from attendance until someone saves them.</span>
      </div>
      {error && <p className="flex items-center gap-2 text-sm text-danger"><Icon name="alert-circle" className="h-4 w-4" />{error}</p>}
      {state.length === 0 ? (
        <EmptyState icon="users" title="Nobody in this branch" hint="People appear here once they have a role in the branch." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-start text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">Person</th>
                {items.map((i) => <th key={i.key} className="px-2 py-2 text-center font-medium">{i.label}</th>)}
                <th className="px-3 py-2 text-start font-medium">Marked</th>
              </tr>
            </thead>
            <tbody>
              {state.map((r) => (
                <tr key={r.userId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.fullName}</div>
                    {r.department && <div className="text-xs text-muted-foreground">{r.department}</div>}
                  </td>
                  {items.map((i) => (
                    <td key={i.key} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${i.label}: ${r.fullName}`}
                        checked={!!r.values[i.key]}
                        disabled={!canEdit || savingId === r.userId}
                        onChange={(e) => save(r, { ...r.values, [i.key]: e.target.checked })}
                        className="h-4 w-4 accent-brand"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">
                    {r.suggested
                      ? <Badge tone="neutral">Not marked</Badge>
                      : <span className="text-muted-foreground">{r.recordedByName ? `by ${r.recordedByName}` : 'Saved'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function MonthView({ month, items, rows, onMonth }: {
  month: string; items: ChecklistItemRow[]; rows: ChecklistMonthRow[]; onMonth: (m: string) => void;
}) {
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ck-month" className="text-sm text-muted-foreground">Month</label>
        <input id="ck-month" type="month" value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} className={field} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing marked this month" hint="Mark days on the Day tab and the totals appear here." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">Person</th>
                <th className="px-3 py-2 text-end font-medium">Days marked</th>
                {items.map((i) => <th key={i.key} className="px-3 py-2 text-end font-medium">{i.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium"><EmployeeLink id={r.userId}>{r.fullName}</EmployeeLink></td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.daysMarked}</td>
                  {items.map((i) => (
                    <td key={i.key} className="px-3 py-2 text-end tabular-nums">
                      {r.ticked[i.key] ?? 0}
                      <span className="ms-1 text-xs text-muted-foreground">({pct(r.ticked[i.key] ?? 0, r.daysMarked)}%)</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function PointsView({ items }: { items: ChecklistItemRow[] }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) setError(r.error);
  });
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm text-muted-foreground">
        These are the points checked for every person each day. Add your own, rename them, or hide one you no longer use.
        Hiding keeps the history.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Card className="divide-y divide-border p-0">
        {items.map((i) => (
          <PointRow key={i.id} item={i} pending={pending}
            onRename={(v) => run(() => updateItemAction(i.id, { label: v }))}
            onToggle={() => run(() => updateItemAction(i.id, { isActive: !i.isActive }))} />
        ))}
      </Card>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await addItemAction(label); if (!r.error) setLabel(''); return r; }); }}>
        <label htmlFor="ck-new" className="sr-only">New point</label>
        <input id="ck-new" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Vehicle checked" className={`${field} flex-1`} />
        <Button type="submit" variant="primary" icon="plus" loading={pending} disabled={!label.trim()}>Add point</Button>
      </form>
    </div>
  );
}

function PointRow({ item, pending, onRename, onToggle }: {
  item: ChecklistItemRow; pending: boolean; onRename: (v: string) => void; onToggle: () => void;
}) {
  const [v, setV] = useState(item.label);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <label htmlFor={`pt-${item.id}`} className="sr-only">Name</label>
      <input id={`pt-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} className={`${field} min-w-0 flex-1`} />
      {v.trim() !== item.label && <Button size="sm" disabled={pending} onClick={() => onRename(v)}>Save</Button>}
      {!item.isActive && <Badge tone="neutral">Hidden</Badge>}
      <Button size="sm" variant="ghost" disabled={pending} onClick={onToggle}>{item.isActive ? 'Hide' : 'Show'}</Button>
    </div>
  );
}
