'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, PageHeader, Segmented } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import type { AccessChange, AccessPerson } from '@/server/access-report';
import type { PersonExtra } from '@/server/people-page';

type Tab = 'login' | 'employee' | 'branches' | 'team' | 'overrides' | 'can' | 'activity';

const day = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
  : '-');
const at = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">{children}<Icon name="arrow-right" className="h-3 w-3" /></Link>;
}

/** One person, every tab (B3 part 1). Read only - each tab links to the screen that changes it. */
export function PersonClient({ storeName, person: p, extra: x, capabilities, changes, canSeeEmployee }: {
  storeName: string;
  person: AccessPerson;
  extra: PersonExtra;
  capabilities: { key: string; sentence: string; group: string }[];
  changes: AccessChange[];
  canSeeEmployee: boolean;
}) {
  const [tab, setTab] = useState<Tab>('can');
  const groups = [...new Set(capabilities.map((c) => c.group))];

  return (
    <div>
      <PageHeader
        badge="user"
        title={p.name}
        subtitle={<>{p.username} · {p.roles.join(', ')} in {storeName}</>}
        actions={<Link href="/settings/people" className="text-sm text-brand hover:underline">All people</Link>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {p.active ? <Badge tone="success" icon="check">Can sign in</Badge> : <Badge>Login off</Badge>}
        {p.hasEmployee ? <Badge tone="success">Employee record</Badge> : <Badge tone="danger" icon="alert-triangle">No employee record</Badge>}
        {x.phonePaired.length > 0 && <Badge tone="info" icon="phone">Phone app signed in</Badge>}
        {p.overrides.length > 0 && <Badge tone="warning">{p.overrides.length} own menu setting{p.overrides.length === 1 ? '' : 's'}</Badge>}
      </div>
      {!p.hasEmployee && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">
          Every login should be an employee. Add their employee record in <Link href="/settings/employees" className="underline">Employees</Link>.
        </p>
      )}

      <div className="mb-4 overflow-x-auto">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: 'can', label: 'What they can do' },
            { value: 'login', label: 'Login' },
            { value: 'employee', label: 'Employee' },
            { value: 'branches', label: 'Branches & roles' },
            { value: 'team', label: 'Reports to' },
            { value: 'overrides', label: 'Overrides' },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        {tab === 'can' && (
          <div className="grid gap-4">
            {capabilities.length === 0 && <p className="text-sm text-muted-foreground">Only their own things - My Desk, own attendance, own tasks.</p>}
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">{g}</p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {capabilities.filter((c) => c.group === g).map((c) => (
                    <li key={c.key} className="flex items-start gap-1.5 text-sm"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{c.sentence}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <Row label="Dashboards">{p.dashboards.join(', ')}</Row>
              <Row label="Phone app">{p.phone.home}{p.phone.sections.length ? ` - ${p.phone.sections.join(', ')}` : ''}</Row>
              <Row label="Menu pages hidden">{p.hiddenPages} that their role would open</Row>
            </div>
            <div className="flex flex-wrap gap-4"><Go href="/settings/roles">Roles</Go><Go href="/settings/access">Access check</Go></div>
          </div>
        )}

        {tab === 'login' && (
          <div>
            <Row label="Username"><span className="font-mono">{p.username}</span></Row>
            <Row label="Login">{p.active ? 'On' : 'Off'}</Row>
            <Row label="Mobile">{x.mobile ?? '-'}</Row>
            <Row label="Email">{x.email ?? '-'}</Row>
            <Row label="Last sign-in">{at(p.lastLoginAt)}</Row>
            <Row label="Phone app">
              {x.phonePaired.length === 0 ? 'Not signed in on a phone' : x.phonePaired.map((d, i) => <span key={i} className="block">{d.device ?? 'A phone'} · last used {at(d.lastUsedAt)}</span>)}
            </Row>
            <div className="mt-3 flex flex-wrap gap-4"><Go href="/settings/users">User List (password, switch login off)</Go><Go href="/settings/login-sessions">Sessions</Go></div>
          </div>
        )}

        {tab === 'employee' && (
          x.employee ? (
            <div>
              <Row label="Department">{x.department ?? '-'}</Row>
              <Row label="Joined">{day(x.employee.joined)}</Row>
              <Row label="Type">{x.employee.type.replace('_', ' ')}</Row>
              {x.employee.exited && <Row label="Left">{day(x.employee.exited)}</Row>}
              {canSeeEmployee && <div className="mt-3"><Go href={`/hrm/employees/${p.id}`}>Employee page</Go></div>}
            </div>
          ) : (
            <p className="text-sm text-danger">No employee record. <Link href="/settings/employees" className="underline">Add it in Employees</Link>.</p>
          )
        )}

        {tab === 'branches' && (
          <div>
            {x.branches.map((b) => <Row key={b.name} label={b.name}>{b.roles.join(', ')}</Row>)}
            <div className="mt-3"><Go href="/settings/user-store-roles">User store roles</Go></div>
          </div>
        )}

        {tab === 'team' && (
          <div>
            <Row label="Reports to">{p.reportsTo ?? <span className="text-muted-foreground">Nobody - &quot;my team&quot; views will not include them</span>}</Row>
            <Row label="Their team">{x.team.length ? x.team.map((t) => <Link key={t.id} href={`/settings/people/${t.id}`} className="me-3 text-brand hover:underline">{t.name}</Link>) : '-'}</Row>
            <div className="mt-3"><Go href="/hierarchy">Org chart</Go></div>
          </div>
        )}

        {tab === 'overrides' && (
          <div>
            {p.overrides.length === 0
              ? <p className="text-sm text-muted-foreground">Their menu is exactly what their roles give.</p>
              : p.overrides.map((o) => <Row key={o.label} label={o.label}>{o.shown ? 'Shown for them (their role hides it)' : 'Hidden for them (their role shows it)'}</Row>)}
            <div className="mt-3 flex flex-wrap gap-4"><Go href="/settings/store-menu-config">Role & User Menu</Go><Go href="/settings/users">Phone app for this person (User List)</Go></div>
          </div>
        )}

        {tab === 'activity' && (
          changes.length === 0
            ? <p className="text-sm text-muted-foreground">No access changes recorded for them.</p>
            : (
              <ul className="grid gap-1.5 text-sm">
                {changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap gap-x-2"><span className="text-muted-foreground">{at(c.at)}</span><span>{c.who}:</span><span>{c.what} {c.action}</span><span className="text-muted-foreground">{c.detail}</span></li>
                ))}
              </ul>
            )
        )}
      </section>
    </div>
  );
}
