'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { ListFilter } from '@/components/ui/ListFilter';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { Badge, PageHeader, Segmented, type BadgeTone } from '@/components/ui/Layout';
import { AREA_LEVEL_LABEL } from '@/lib/access-capabilities';
import type { ModuleLevel } from '@/lib/role-modules';
import type { AccessPerson, AccessReport } from '@/server/access-report';

type Tab = 'who' | 'people' | 'warnings' | 'changes';

const LEVEL_TONE: Record<ModuleLevel, BadgeTone> = { none: 'neutral', view: 'info', edit: 'brand', approve: 'success' };

const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-');

/**
 * Access check (B2, 11 Oct 2026). Four views of one report:
 *   Who can…      search a plain sentence, see the names
 *   People        one row per person, None / See / Change / Approve per area
 *   Things to check  logins with no employee record (P3), no role, many
 *                 admins, a person's menu that differs from their role…
 *   Changes       who changed whose access, from the audit trail
 * Read only. Every fix opens the screen that makes it.
 */
export function AccessClient({ report }: { report: AccessReport }) {
  const [tab, setTab] = useState<Tab>('who');
  const [open, setOpen] = useState<AccessPerson | null>(null);
  const problems = report.warnings.filter((w) => w.severity === 'problem').length;
  const groups = [...new Set(report.areas.map((a) => a.group))];
  const active = report.people.filter((p) => p.active);

  const peopleCols: Column<AccessPerson>[] = [
    {
      key: 'name', header: 'Person', nowrap: true,
      render: (p) => (
        <button type="button" onClick={() => setOpen(p)} className="text-start">
          <span className="block font-medium text-brand hover:underline">{p.name}</span>
          <span className="block text-xs text-muted-foreground">{p.username}{!p.active && ' · login off'}</span>
        </button>
      ),
      sortValue: (p) => p.name,
    },
    { key: 'roles', header: 'Roles', render: (p) => <span className="text-xs">{p.roles.join(', ')}</span>, sortValue: (p) => p.roles.join(',') },
    {
      key: 'employee', header: 'Employee record',
      render: (p) => (p.hasEmployee ? <Badge tone="success" icon="check">Yes</Badge> : <Badge tone="danger" icon="alert-triangle">Missing</Badge>),
      sortValue: (p) => (p.hasEmployee ? 1 : 0),
    },
    ...report.areas.map((a): Column<AccessPerson> => ({
      key: `area.${a.key}`, header: a.label, optional: true, align: 'center',
      render: (p) => (p.levels[a.key] === 'none'
        ? <span className="text-xs text-muted-foreground">-</span>
        : <Badge tone={LEVEL_TONE[p.levels[a.key]!]}>{AREA_LEVEL_LABEL[p.levels[a.key]!]}</Badge>),
      sortValue: (p) => ['none', 'view', 'edit', 'approve'].indexOf(p.levels[a.key] ?? 'none'),
    })),
    { key: 'dash', header: 'Dashboards', optional: true, render: (p) => <span className="text-xs">{p.dashboards.join(', ')}</span> },
    { key: 'phone', header: 'Phone app', optional: true, render: (p) => <span className="text-xs">{p.phone.home}{p.phone.sections.length ? ` · ${p.phone.sections.join(', ')}` : ''}</span> },
    { key: 'hidden', header: 'Pages hidden', align: 'end', optional: true, render: (p) => <span className="font-mono text-xs">{p.hiddenPages}</span>, sortValue: (p) => p.hiddenPages },
    { key: 'reports', header: 'Reports to', optional: true, render: (p) => <span className="text-xs">{p.reportsTo ?? '-'}</span>, sortValue: (p) => p.reportsTo ?? '' },
    { key: 'login', header: 'Last sign-in', optional: true, render: (p) => <span className="text-xs">{when(p.lastLoginAt)}</span>, sortValue: (p) => p.lastLoginAt ?? '' },
  ];

  type Cap = AccessReport['capabilities'][number];
  const capCols: Column<Cap>[] = [
    { key: 'sentence', header: 'Can…', render: (c) => <span className="text-sm">{c.sentence}</span>, sortValue: (c) => c.sentence },
    { key: 'area', header: 'Area', render: (c) => <span className="text-xs text-muted-foreground">{c.group} · {c.area}</span>, sortValue: (c) => `${c.group} ${c.area}` },
    {
      key: 'who', header: 'Who', render: (c) => (c.who.length
        ? <span className="text-xs">{c.who.join(', ')}</span>
        : <span className="text-xs text-muted-foreground">Nobody</span>),
      sortValue: (c) => c.who.length,
    },
  ];

  type Change = AccessReport['changes'][number];
  const changeCols: Column<Change>[] = [
    { key: 'at', header: 'When', nowrap: true, render: (c) => <span className="text-xs">{when(c.at)}</span>, sortValue: (c) => c.at },
    { key: 'who', header: 'Changed by', render: (c) => <span className="text-xs">{c.who}</span>, sortValue: (c) => c.who },
    { key: 'what', header: 'What', render: (c) => <span className="text-xs">{c.what} <span className="text-muted-foreground">{c.action}</span></span>, sortValue: (c) => c.what },
    { key: 'detail', header: 'Detail', render: (c) => <span className="text-xs text-muted-foreground">{c.detail}</span> },
  ];

  return (
    <div>
      <PageHeader
        badge="shield-check"
        title="Access check"
        subtitle={<>{report.storeName} · {active.length} people · read only - each fix opens the screen that makes it</>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'who', label: 'Who can…', icon: 'search' },
            { value: 'people', label: 'People', icon: 'users' },
            { value: 'warnings', label: `Things to check (${report.warnings.length})`, icon: 'alert-triangle' },
            { value: 'changes', label: 'Changes', icon: 'clock' },
          ]}
        />
        {problems > 0 && <Badge tone="danger" icon="alert-circle">{problems} to fix</Badge>}
      </div>

      {tab === 'who' && (
        <ListFilter
          rows={report.capabilities}
          searchOn={(c) => [c.sentence, c.area, c.group, ...c.who]}
          placeholder="Who can… approve a purchase, see payroll, pay suppliers, or a person's name"
          paramKey="cq"
          noun="abilities"
          chips={groups.map((g) => ({ value: g, label: g }))}
          chipOf={(c) => c.group}
          chipLabel="Area"
          exportAs={{ title: 'Who can do what', columns: [
            { header: 'Can', value: (c) => c.sentence }, { header: 'Area', value: (c) => c.area }, { header: 'Who', value: (c) => c.who.join(', ') },
          ] }}
        >
          {(rows) => <DataGrid rows={rows} columns={capCols} rowKey={(c) => c.key} emptyIcon="search" emptyMessage="Nothing matches." pageSizes={[25, 50, 100]} />}
        </ListFilter>
      )}

      {tab === 'people' && (
        <ListFilter
          rows={report.people}
          searchOn={(p) => [p.name, p.username, ...p.roles, p.reportsTo]}
          placeholder="Name, username, role, manager…"
          noun="people"
          chips={[{ value: 'active', label: 'Can sign in' }, { value: 'off', label: 'Login off' }, { value: 'noemp', label: 'No employee record' }]}
          chipOf={(p) => (!p.active ? 'off' : !p.hasEmployee ? 'noemp' : 'active')}
          chipLabel="Login"
          selects={[{ key: 'role', label: 'Role', of: (p) => p.roles[0] ?? null, options: report.roles.map((r) => r.name) }]}
          exportAs={{ title: 'Access by person', columns: [
            { header: 'Person', value: (p) => p.name }, { header: 'Username', value: (p) => p.username }, { header: 'Roles', value: (p) => p.roles.join(', ') },
            { header: 'Employee record', value: (p) => (p.hasEmployee ? 'Yes' : 'No') },
            ...report.areas.map((a) => ({ header: a.label, value: (p: AccessPerson) => AREA_LEVEL_LABEL[p.levels[a.key] ?? 'none'] })),
            { header: 'Dashboards', value: (p) => p.dashboards.join(', ') }, { header: 'Reports to', value: (p) => p.reportsTo ?? '' },
          ] }}
        >
          {(rows) => (
            <DataGrid
              rows={rows} columns={peopleCols} rowKey={(p) => p.id}
              emptyIcon="users" emptyMessage="Nobody has a role in this branch."
              pageSizes={[25, 50, 100]}
              actions={[{ label: 'What they can do', icon: 'eye', onSelect: (p) => setOpen(p) }]}
              mobileCard={(p) => (
                <button type="button" onClick={() => setOpen(p)} className="block w-full text-start">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.roles.join(', ')} · {p.capabilities.length} abilities{!p.hasEmployee && ' · no employee record'}</span>
                </button>
              )}
            />
          )}
        </ListFilter>
      )}

      {tab === 'warnings' && (
        report.warnings.length === 0
          ? <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-on-tint-success">Nothing looks wrong in this branch.</p>
          : (
            <ul className="grid gap-2">
              {report.warnings.map((w, i) => (
                <li key={i} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${w.severity === 'problem' ? 'border-danger/30 bg-danger/[0.05]' : 'border-border bg-card'}`}>
                  <Icon name={w.severity === 'problem' ? 'alert-circle' : 'info'} className={`mt-0.5 h-4 w-4 shrink-0 ${w.severity === 'problem' ? 'text-danger' : 'text-muted-foreground'}`} />
                  <span className="min-w-0 flex-1">{w.text}</span>
                  {w.href && <Link href={w.href} className="shrink-0 text-xs font-medium text-brand hover:underline">Fix it</Link>}
                </li>
              ))}
            </ul>
          )
      )}

      {tab === 'changes' && (
        <ListFilter
          rows={report.changes}
          searchOn={(c) => [c.who, c.what, c.detail]}
          placeholder="Who changed it, a role, a person, a menu…"
          paramKey="hq"
          noun="changes"
          dates={[{ key: 'at', label: 'Changed on', of: (c) => c.at }]}
          exportAs={{ title: 'Access changes', columns: [
            { header: 'When', value: (c) => c.at }, { header: 'Changed by', value: (c) => c.who }, { header: 'What', value: (c) => `${c.what} ${c.action}` }, { header: 'Detail', value: (c) => c.detail },
          ] }}
        >
          {(rows) => <DataGrid rows={rows} columns={changeCols} rowKey={(c) => c.id} emptyIcon="clock" emptyMessage="No access changes recorded." pageSizes={[25, 50, 100]} />}
        </ListFilter>
      )}

      {open && (
        <Modal title={open.name} subtitle={`${open.roles.join(', ')} · ${report.storeName}`} icon="shield-check" onClose={() => setOpen(null)}>
          <div className="grid gap-4 text-sm">
            {!open.hasEmployee && <p className="rounded-lg bg-danger/10 px-3 py-2 text-on-tint-danger">No employee record - every login should be an employee.</p>}
            <section>
              <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">They can</p>
              {open.capabilities.length === 0
                ? <p className="text-muted-foreground">Only their own things - My Desk, own attendance, own tasks.</p>
                : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {report.capabilities.filter((c) => open.capabilities.includes(c.key)).map((c) => (
                      <li key={c.key} className="flex items-start gap-1.5"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{c.sentence}</li>
                    ))}
                  </ul>
                )}
            </section>
            <section className="grid gap-1">
              <p><span className="text-muted-foreground">Dashboards:</span> {open.dashboards.join(', ')}</p>
              <p><span className="text-muted-foreground">Phone app:</span> {open.phone.home}{open.phone.sections.length ? ` - ${open.phone.sections.join(', ')}` : ''}</p>
              <p><span className="text-muted-foreground">Menu pages their role allows but their menu hides:</span> {open.hiddenPages}</p>
              {open.overrides.length > 0 && <p><span className="text-muted-foreground">Their own menu settings:</span> {open.overrides.map((o) => `${o.label} ${o.shown ? 'shown' : 'hidden'}`).join(', ')}</p>}
              <p><span className="text-muted-foreground">Reports to:</span> {open.reportsTo ?? 'nobody'}</p>
            </section>
            <div className="flex flex-wrap gap-3 text-xs">
              <Link href={`/hrm/employees/${open.id}`} className="text-brand hover:underline">Employee page</Link>
              <Link href="/settings/user-store-roles" className="text-brand hover:underline">Branches & roles</Link>
              <Link href="/settings/store-menu-config" className="text-brand hover:underline">Role & User Menu</Link>
              <Link href="/settings/roles" className="text-brand hover:underline">Roles</Link>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
