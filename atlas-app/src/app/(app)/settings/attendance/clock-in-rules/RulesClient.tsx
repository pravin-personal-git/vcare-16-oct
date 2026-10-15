'use client';

import { useMemo, useState, useTransition } from 'react';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ALLOW_LABEL, ALLOW_MODES, OUTSIDE_LABEL, type AllowMode, type OutsideMode } from '@/lib/attendance-rule';
import { saveClockInRuleAction } from './actions';

interface Zone { id: string; label: string; radiusMeters: number }
interface Person {
  userId: string; name: string; username: string;
  allow: AllowMode; outside: OutsideMode; zoneIds: string[];
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function RulesClient({ scopeIsAll, canEdit, geofencing, zones, people }: {
  scopeIsAll: boolean; canEdit: boolean; geofencing: boolean; zones: Zone[]; people: Person[];
}) {
  const [rows, setRows] = useState(people);
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zoneName = useMemo(() => new Map(zones.map((z) => [z.id, z.label])), [zones]);

  const header = (
    <PageHeader badge="map-pin" title="Clock-in Rules" subtitle="Where each person may clock in from the Vcare app" />
  );
  if (scopeIsAll) {
    return (
      <div>
        {header}
        <Card><EmptyState icon="map-pin" title="Select a single branch" hint="Zones and rules belong to a branch." /></Card>
      </div>
    );
  }

  const shown = rows.filter((r) => !q || `${r.name} ${r.username}`.toLowerCase().includes(q.toLowerCase()));
  const summary = (p: Person) => {
    if (p.allow === 'store_default') return geofencing ? 'Branch geofence - flagged when outside' : 'Branch setting - geofence is off';
    if (p.allow === 'anywhere') return 'Anywhere';
    const zs = p.zoneIds.length ? p.zoneIds.map((id) => zoneName.get(id) ?? '?').join(', ') : 'Any office zone';
    return p.allow === 'zones_or_sites' ? `${zs}, or an assigned job site` : zs;
  };

  const save = (p: Person) => {
    setError(null);
    start(async () => {
      const res = await saveClockInRuleAction({ userId: p.userId, allow: p.allow, outside: p.outside, zoneIds: p.zoneIds });
      if (res.error) { setError(res.error); return; }
      setRows((rs) => rs.map((r) => (r.userId === p.userId ? p : r)));
      setEditing(null);
    });
  };

  return (
    <div>
      {header}
      {zones.length === 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/40 bg-warning/10 px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed">
            This branch has no office zones yet. Add them under <strong>Time Policies</strong> - until then a
            zones rule has nothing to check against and never blocks anyone.
          </p>
        </Card>
      )}
      {error && <Card className="mb-3 border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">{error}</Card>}

      <SectionCard
        title={`People (${rows.length})`}
        icon="users"
        bodyClassName="p-0"
        action={
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={`${input} !w-44`} aria-label="Search people" />
        }
      >
        <ul className="divide-y divide-border">
          {shown.map((p) => (
            <li key={p.userId} className="px-4 py-3">
              {editing === p.userId ? (
                <Editor person={p} zones={zones} pending={pending} onCancel={() => setEditing(null)} onSave={save} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.name} <span className="font-normal text-muted-foreground">@{p.username}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{summary(p)}</p>
                  </div>
                  {(p.allow === 'zones' || p.allow === 'zones_or_sites') && (
                    <Badge tone={p.outside === 'block' ? 'danger' : 'warning'}>{OUTSIDE_LABEL[p.outside]}</Badge>
                  )}
                  {p.allow === 'anywhere' && <Badge tone="neutral">Not checked</Badge>}
                  {canEdit && <Button size="sm" onClick={() => setEditing(p.userId)}>Change</Button>}
                </div>
              )}
            </li>
          ))}
          {shown.length === 0 && <li><EmptyState icon="users" title="Nobody matches" /></li>}
        </ul>
      </SectionCard>
    </div>
  );
}

function Editor({ person, zones, pending, onCancel, onSave }: {
  person: Person; zones: Zone[]; pending: boolean; onCancel: () => void; onSave: (p: Person) => void;
}) {
  const [p, setP] = useState(person);
  const usesZones = p.allow === 'zones' || p.allow === 'zones_or_sites';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{p.name}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">May clock in from</span>
          <select className={input} value={p.allow} onChange={(e) => setP({ ...p, allow: e.target.value as AllowMode })}>
            {ALLOW_MODES.map((m) => <option key={m} value={m}>{ALLOW_LABEL[m]}</option>)}
          </select>
        </label>
        {usesZones && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">When outside those places</span>
            <select className={input} value={p.outside} onChange={(e) => setP({ ...p, outside: e.target.value as OutsideMode })}>
              <option value="flag">Allow the clock-in and flag it</option>
              <option value="block">Block the clock-in</option>
            </select>
          </label>
        )}
      </div>
      {usesZones && zones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Zones (none ticked = every office zone)</span>
          <div className="flex flex-wrap gap-2">
            {zones.map((z) => {
              const on = p.zoneIds.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setP({ ...p, zoneIds: on ? p.zoneIds.filter((id) => id !== z.id) : [...p.zoneIds, z.id] })}
                  className={`rounded-full border px-3 py-1 text-xs transition ${on ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-card text-foreground hover:bg-muted'}`}
                >
                  {z.label} · {z.radiusMeters} m
                </button>
              );
            })}
          </div>
        </div>
      )}
      {p.allow === 'zones_or_sites' && (
        <p className="text-xs text-muted-foreground">
          Job sites are the locations of unresolved complaints assigned to them, within 250 m.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={pending} onClick={() => onSave(p)}>Save</Button>
        <Button size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
