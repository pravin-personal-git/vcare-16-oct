'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AddPersonDialog, type AddPersonOptions } from './AddPersonDialog';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { ListFilter } from '@/components/ui/ListFilter';
import { Badge, PageHeader } from '@/components/ui/Layout';
import type { AccessPerson } from '@/server/access-report';
import type { PersonExtra } from '@/server/people-page';

const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
  : '-');

/**
 * People (B3 part 1, 11 Oct 2026): one row per person - login, employee
 * record, branches and roles, manager, phone - and a page per person. Read
 * only; each fix happens on the screen that owns it.
 */
export function PeopleClient({ storeName, people, extra, roles, addOptions }: {
  storeName: string;
  people: AccessPerson[];
  extra: Record<string, PersonExtra>;
  roles: string[];
  /** Null when this person may not add people (or the business is read only). */
  addOptions: AddPersonOptions | null;
}) {
  const [adding, setAdding] = useState(false);
  // ?add=1 (User List's "Add User" comes here) opens the form - in an effect,
  // never in useState's first value, or the server render disagrees (G4).
  useEffect(() => {
    if (addOptions && new URLSearchParams(window.location.search).get('add') === '1') setAdding(true);
  }, [addOptions]);
  const x = (p: AccessPerson) => extra[p.id];
  const missing = people.filter((p) => p.active && !p.hasEmployee).length;

  const cols: Column<AccessPerson>[] = [
    {
      key: 'name', header: 'Person', nowrap: true,
      render: (p) => (
        <Link href={`/settings/people/${p.id}`} className="block">
          <span className="block font-medium text-brand hover:underline">{p.name}</span>
          <span className="block text-xs text-muted-foreground">{p.username}</span>
        </Link>
      ),
      sortValue: (p) => p.name,
    },
    { key: 'login', header: 'Login', render: (p) => (p.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>), sortValue: (p) => (p.active ? 1 : 0) },
    {
      key: 'employee', header: 'Employee record',
      render: (p) => (p.hasEmployee ? <Badge tone="success" icon="check">Yes</Badge> : <Badge tone="danger" icon="alert-triangle">Missing</Badge>),
      sortValue: (p) => (p.hasEmployee ? 1 : 0),
    },
    { key: 'roles', header: 'Roles here', render: (p) => <span className="text-xs">{p.roles.join(', ')}</span>, sortValue: (p) => p.roles.join(',') },
    { key: 'branches', header: 'Branches', optional: true, render: (p) => <span className="text-xs">{x(p)?.branches.map((b) => b.name).join(', ')}</span> },
    { key: 'reports', header: 'Reports to', render: (p) => <span className="text-xs">{p.reportsTo ?? '-'}</span>, sortValue: (p) => p.reportsTo ?? '' },
    { key: 'phone', header: 'Phone app', optional: true, render: (p) => <span className="text-xs">{x(p)?.phonePaired.length ? `Signed in (${x(p)!.phonePaired.length})` : '-'}</span>, sortValue: (p) => x(p)?.phonePaired.length ?? 0 },
    { key: 'mobile', header: 'Mobile', optional: true, render: (p) => <span className="font-mono text-xs">{x(p)?.mobile ?? '-'}</span> },
    { key: 'last', header: 'Last sign-in', optional: true, render: (p) => <span className="text-xs">{when(p.lastLoginAt)}</span>, sortValue: (p) => p.lastLoginAt ?? '' },
  ];

  return (
    <div>
      <PageHeader
        badge="users"
        title="People"
        subtitle={<>{storeName} · {people.filter((p) => p.active).length} can sign in{missing ? <> · <span className="text-danger">{missing} without an employee record</span></> : null}</>}
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/settings/access" className="text-sm font-medium text-brand hover:underline">Access check</Link>
            {addOptions && <Button variant="primary" icon="user-plus" onClick={() => setAdding(true)}>Add a person</Button>}
          </div>
        )}
      />
      <ListFilter
        rows={people}
        searchOn={(p) => [p.name, p.username, ...p.roles, p.reportsTo, x(p)?.mobile, x(p)?.email, x(p)?.department]}
        placeholder="Name, username, mobile, role, manager…"
        noun="people"
        chips={[{ value: 'active', label: 'Can sign in' }, { value: 'off', label: 'Login off' }, { value: 'noemp', label: 'No employee record' }]}
        chipOf={(p) => (!p.active ? 'off' : !p.hasEmployee ? 'noemp' : 'active')}
        chipLabel="Login"
        selects={[{ key: 'role', label: 'Role', of: (p) => p.roles[0] ?? null, options: roles }]}
        exportAs={{ title: 'People', columns: [
          { header: 'Person', value: (p) => p.name }, { header: 'Username', value: (p) => p.username },
          { header: 'Login', value: (p) => (p.active ? 'On' : 'Off') }, { header: 'Employee record', value: (p) => (p.hasEmployee ? 'Yes' : 'Missing') },
          { header: 'Roles here', value: (p) => p.roles.join(', ') }, { header: 'Branches', value: (p) => x(p)?.branches.map((b) => b.name).join(', ') ?? '' },
          { header: 'Reports to', value: (p) => p.reportsTo ?? '' }, { header: 'Mobile', value: (p) => x(p)?.mobile ?? '' },
        ] }}
      >
        {(rows) => (
          <DataGrid
            rows={rows} columns={cols} rowKey={(p) => p.id}
            emptyIcon="users" emptyMessage="Nobody has a role in this branch."
            pageSizes={[25, 50, 100]}
            actions={[{ label: 'Open', icon: 'external-link', onSelect: (p) => { window.location.href = `/settings/people/${p.id}`; } }]}
            mobileCard={(p) => (
              <Link href={`/settings/people/${p.id}`} className="block">
                <span className="block font-medium">{p.name}{!p.active && <span className="text-muted-foreground"> · login off</span>}</span>
                <span className="block text-xs text-muted-foreground">{p.roles.join(', ')}{p.reportsTo ? ` · reports to ${p.reportsTo}` : ''}{!p.hasEmployee ? ' · no employee record' : ''}</span>
              </Link>
            )}
          />
        )}
      </ListFilter>
      {adding && addOptions && <AddPersonDialog options={addOptions} storeName={storeName} onClose={() => setAdding(false)} />}
    </div>
  );
}
