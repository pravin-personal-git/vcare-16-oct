'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { setTeamAssignmentAction } from './actions';

interface Row {
  userId: string;
  fullName: string;
  isActive: boolean;
  current: {
    id: string;
    managerId: string | null;
    managerName: string | null;
    designationRoleId: string | null;
    designationLabel: string | null;
    storeId: string | null;
    storeName: string | null;
    effectiveFrom: string;
  } | null;
  history: {
    id: string;
    managerName: string | null;
    designationLabel: string | null;
    storeName: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
}

interface TeamAssignmentDraft { managerId: string; designationRoleId: string; storeId: string }

const input = 'h-9 w-full rounded-lg border border-border bg-card px-2 text-xs outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function TeamSetupClient({
  rows, designations, stores, canEdit,
}: {
  rows: Row[];
  designations: { id: string; label: string }[];
  stores: { id: string; name: string; branchCode: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, TeamAssignmentDraft>>({});

  const draftFor = (r: Row): TeamAssignmentDraft => draft[r.userId] ?? {
    managerId: r.current?.managerId ?? '',
    designationRoleId: r.current?.designationRoleId ?? '',
    storeId: r.current?.storeId ?? '',
  };

  const setField = (userId: string, patch: Partial<TeamAssignmentDraft>) => {
    setDraft((d) => ({ ...d, [userId]: { ...draftFor(rows.find((r) => r.userId === userId)!), ...d[userId], ...patch } }));
  };

  const managerOptions = rows.filter((r) => r.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const save = (r: Row) => {
    const d = draftFor(r);
    setError(null); setNotice(null);
    startTransition(async () => {
      const res = await setTeamAssignmentAction(r.userId, {
        managerId: d.managerId || null,
        designationRoleId: d.designationRoleId || null,
        storeId: d.storeId || null,
      });
      if (res.error) setError(res.error);
      else {
        setNotice(res.message ?? 'Saved.');
        setDraft((d) => { const next = { ...d }; delete next[r.userId]; return next; });
        router.refresh();
      }
    });
  };

  const toggleHistory = (userId: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  });

  return (
    <div>
      <PageHeader badge="TS" title="Team Setup" subtitle="Designation, reporting manager and branch, per person - with history" />

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

      <SectionCard title={`${rows.length} people`} icon="users" bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="users" title="Nobody to show" />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const d = draftFor(r);
              const isOpen = expanded.has(r.userId);
              return (
                <div key={r.userId} className="p-3">
                  <div className="grid items-center gap-2 sm:grid-cols-[1fr_repeat(3,10rem)_auto]">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {r.fullName}
                      {!r.isActive && <Badge tone="neutral">Inactive</Badge>}
                    </span>
                    <select disabled={!canEdit || pending} value={d.designationRoleId}
                      onChange={(e) => setField(r.userId, { designationRoleId: e.target.value })}
                      className={input} aria-label={`${r.fullName}'s designation`}>
                      <option value="">No designation</option>
                      {designations.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                    <select disabled={!canEdit || pending} value={d.managerId}
                      onChange={(e) => setField(r.userId, { managerId: e.target.value })}
                      className={input} aria-label={`${r.fullName}'s manager`}>
                      <option value="">Reports to nobody</option>
                      {managerOptions.filter((m) => m.userId !== r.userId).map((m) => (
                        <option key={m.userId} value={m.userId}>{m.fullName}</option>
                      ))}
                    </select>
                    <select disabled={!canEdit || pending} value={d.storeId}
                      onChange={(e) => setField(r.userId, { storeId: e.target.value })}
                      className={input} aria-label={`${r.fullName}'s branch`}>
                      <option value="">No branch</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="flex items-center gap-1.5">
                      {canEdit && (
                        <button type="button" disabled={pending} onClick={() => save(r)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-2.5 text-xs font-medium text-brand-fg transition hover:opacity-90 disabled:opacity-60">
                          <Icon name="check" className="h-3.5 w-3.5" />
                          Save
                        </button>
                      )}
                      {r.history.length > 0 && (
                        <button type="button" onClick={() => toggleHistory(r.userId)}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted"
                          aria-label="Toggle history">
                          <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {r.current && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Since {fmt(r.current.effectiveFrom)}
                    </p>
                  )}

                  {isOpen && r.history.length > 0 && (
                    <ul className="mt-2 grid gap-1 rounded-lg bg-muted/30 p-2">
                      {r.history.map((h) => (
                        <li key={h.id} className="text-xs text-muted-foreground">
                          {fmt(h.effectiveFrom)} - {h.effectiveTo ? fmt(h.effectiveTo) : 'now'}:{' '}
                          {h.designationLabel ?? 'No designation'}, reported to {h.managerName ?? 'nobody'}
                          {h.storeName ? `, ${h.storeName}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
