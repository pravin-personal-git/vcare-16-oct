'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { Modal } from '@/components/ui/Modal';
import { Toolbar } from '@/components/ui/Toolbar';
import type { EmployeeRow } from '@/server/employees';
import { updateEmployeeAction } from './actions';

type Opt = { id: string; name?: string; label?: string };

const TYPE_LABEL: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', intern: 'Intern' };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const field = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function EmployeesClient({ employees, departments, designations, branches, canEdit, canSeeBank, canEditBank }: {
  employees: EmployeeRow[];
  departments: Opt[];
  designations: Opt[];
  branches: Opt[];
  canEdit: boolean;
  canSeeBank: boolean;
  canEditBank: boolean;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'left'>('active');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<EmployeeRow | null>(null);

  const rows = useMemo(
    () => employees.filter((e) => (status === 'active' ? e.isActive : !e.isActive) && (!dept || e.departmentId === dept)),
    [employees, status, dept],
  );
  const active = employees.filter((e) => e.isActive).length;

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'name', header: 'Employee', sortValue: (e) => e.fullName,
      render: (e) => (
        <div>
          <button type="button" onClick={() => setOpen(e)} className="block text-start text-sm font-medium text-brand hover:underline">{e.fullName}</button>
          {/* G-37: the code opens their page - attendance, leave, jobs, payslips. */}
          <span className="block text-xs text-muted-foreground">@{e.username} · <EmployeeLink id={e.id} className="font-mono">{e.userCode}</EmployeeLink></span>
        </div>
      ),
    },
    { key: 'designation', header: 'Designation', sortValue: (e) => e.designationLabel, render: (e) => <span className="text-xs">{e.designationLabel ?? '-'}</span> },
    { key: 'department', header: 'Department', sortValue: (e) => e.departmentName, render: (e) => <span className="text-xs">{e.departmentName ?? '-'}</span> },
    { key: 'manager', header: 'Reports to', sortValue: (e) => e.managerName, render: (e) => <span className="text-xs">{e.managerName ?? '-'}</span> },
    { key: 'phone', header: 'Phone', sortValue: (e) => e.phone, render: (e) => <span className="font-mono text-xs">{e.phone ?? '-'}</span> },
    { key: 'roles', header: 'Roles', sortValue: (e) => e.roles.join(', '), render: (e) => <span className="text-xs">{e.roles.join(', ') || '-'}</span> },
    { key: 'joined', header: 'Joined', sortValue: (e) => e.profile.dateOfJoining, render: (e) => <span className="text-xs">{fmt(e.profile.dateOfJoining)}</span> },
    {
      key: 'phoneApp', header: 'Vcare', sortValue: (e) => (e.phonePaired ? 1 : 0),
      render: (e) => e.phonePaired ? <Badge tone="success">Phone paired</Badge> : <Badge tone="neutral">No phone</Badge>,
    },
    { key: 'type', header: 'Type', optional: true, sortValue: (e) => e.profile.employmentType, render: (e) => <span className="text-xs">{TYPE_LABEL[e.profile.employmentType] ?? e.profile.employmentType}</span> },
    { key: 'branch', header: 'Branch', optional: true, sortValue: (e) => e.branchName, render: (e) => <span className="text-xs">{e.branchName ?? '-'}</span> },
    { key: 'email', header: 'Email', optional: true, sortValue: (e) => e.email, render: (e) => <span className="text-xs">{e.email ?? '-'}</span> },
    { key: 'lastLogin', header: 'Last sign-in', optional: true, sortValue: (e) => e.lastLoginAt, render: (e) => <span className="text-xs">{fmt(e.lastLoginAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        badge="users"
        title="Employees"
        subtitle={`${active} active · details, reporting line and pay details in one place`}
        actions={<Link href="/settings/users"><Button icon="user-plus">Add a person (Users)</Button></Link>}
      />
      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name, code, phone, department…"
        count={`Total (${rows.length})`}
        filters={
          <>
            <select aria-label="Active or left" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'left')} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="active">Active</option>
              <option value="left">Left / inactive</option>
            </select>
            <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        }
      />
      <DataGrid
        rows={rows}
        columns={columns}
        rowKey={(e) => e.id}
        search={search}
        emptyIcon="users"
        emptyMessage="Nobody here"
        emptyHint="People are added under Settings → Users; their details are completed here."
        actions={[{ label: canEdit ? 'Edit details' : 'View details', icon: 'pencil', onSelect: (e) => setOpen(e) }]}
      />
      {open && (
        <EmployeeDialog
          employee={open} departments={departments} designations={designations} branches={branches}
          managers={employees.filter((x) => x.isActive && x.id !== open.id).map((x) => ({ id: x.id, name: x.fullName }))}
          canEdit={canEdit} canSeeBank={canSeeBank} canEditBank={canEditBank}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function L({ id, label, children, wide }: { id: string; label: string; children: React.ReactNode; wide?: boolean }): React.ReactElement {
  return (
  <div className={`grid gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>
  );
}

function EmployeeDialog({ employee: e, departments, designations, branches, managers, canEdit, canSeeBank, canEditBank, onClose }: {
  employee: EmployeeRow; departments: Opt[]; designations: Opt[]; branches: Opt[]; managers: Opt[];
  canEdit: boolean; canSeeBank: boolean; canEditBank: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    fullName: e.fullName, phone: e.phone ?? '', email: e.email ?? '', departmentId: e.departmentId ?? '',
    managerId: e.managerId ?? '', designationRoleId: e.designationRoleId ?? '', branchId: e.branchId ?? '',
    dateOfJoining: e.profile.dateOfJoining ?? '', dateOfBirth: e.profile.dateOfBirth ?? '', employmentType: e.profile.employmentType,
    personalEmail: e.profile.personalEmail ?? '', address: e.profile.address ?? '',
    emergencyContactName: e.profile.emergencyContactName ?? '', emergencyContactPhone: e.profile.emergencyContactPhone ?? '',
    bankAccountNumber: e.profile.bankAccountNumber ?? '', bankIfsc: e.profile.bankIfsc ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const ro = !canEdit;

  const save = () => start(async () => {
    setError(null);
    const r = await updateEmployeeAction(e.id, {
      ...f,
      departmentId: f.departmentId || null, managerId: f.managerId || null, designationRoleId: f.designationRoleId || null,
      branchId: f.branchId || null, dateOfJoining: f.dateOfJoining || null, dateOfBirth: f.dateOfBirth || null,
      phone: f.phone || null, email: f.email || null, personalEmail: f.personalEmail || null, address: f.address || null,
      emergencyContactName: f.emergencyContactName || null, emergencyContactPhone: f.emergencyContactPhone || null,
      bankAccountNumber: canEditBank ? f.bankAccountNumber || null : undefined, bankIfsc: canEditBank ? f.bankIfsc || null : undefined,
    });
    if (r.error) { setError(r.error); return; }
    onClose();
    router.refresh();
  });


  return (
    <Modal
      title={e.fullName}
      subtitle={`@${e.username} · ${e.userCode}${e.phonePaired ? ' · phone paired' : ''}`}
      icon="user"
      size="md"
      onClose={onClose}
      footer={canEdit ? (
        <div className="flex items-center justify-end gap-2">
          {error && <p className="me-auto text-sm text-danger">{error}</p>}
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={pending}>Save</Button>
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Work</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <L id="em-name" label="Full name"><input id="em-name" disabled={ro} value={f.fullName} onChange={set('fullName')} className={field} /></L>
            <L id="em-type" label="Employment type">
              <select id="em-type" disabled={ro} value={f.employmentType} onChange={set('employmentType')} className={field}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </L>
            <L id="em-desig" label="Designation">
              <select id="em-desig" disabled={ro} value={f.designationRoleId} onChange={set('designationRoleId')} className={field}>
                <option value="">Not set</option>
                {designations.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </L>
            <L id="em-dept" label="Department">
              <select id="em-dept" disabled={ro} value={f.departmentId} onChange={set('departmentId')} className={field}>
                <option value="">Not set</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </L>
            <L id="em-mgr" label="Reports to">
              <select id="em-mgr" disabled={ro} value={f.managerId} onChange={set('managerId')} className={field}>
                <option value="">Nobody</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </L>
            <L id="em-branch" label="Branch">
              <select id="em-branch" disabled={ro} value={f.branchId} onChange={set('branchId')} className={field}>
                <option value="">Not set</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </L>
            <L id="em-doj" label="Date of joining"><input id="em-doj" type="date" disabled={ro} value={f.dateOfJoining} onChange={set('dateOfJoining')} className={field} /></L>
            <L id="em-roles" label="Roles (Settings → User Store Roles)"><input id="em-roles" disabled value={e.roles.join(', ')} className={field} /></L>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <L id="em-phone" label="Phone"><input id="em-phone" disabled={ro} value={f.phone} onChange={set('phone')} className={field} inputMode="tel" /></L>
            <L id="em-email" label="Work email"><input id="em-email" disabled={ro} value={f.email} onChange={set('email')} className={field} type="email" /></L>
            <L id="em-pemail" label="Personal email"><input id="em-pemail" disabled={ro} value={f.personalEmail} onChange={set('personalEmail')} className={field} type="email" /></L>
            <L id="em-dob" label="Date of birth"><input id="em-dob" type="date" disabled={ro} value={f.dateOfBirth} onChange={set('dateOfBirth')} className={field} /></L>
            <L id="em-addr" label="Address" wide><textarea id="em-addr" disabled={ro} rows={2} value={f.address} onChange={set('address')} className={`${field} h-auto py-2`} /></L>
            <L id="em-ecn" label="Emergency contact"><input id="em-ecn" disabled={ro} value={f.emergencyContactName} onChange={set('emergencyContactName')} className={field} /></L>
            <L id="em-ecp" label="Emergency phone"><input id="em-ecp" disabled={ro} value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} className={field} inputMode="tel" /></L>
          </div>
        </section>
        {canSeeBank && (
          <section>
            <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Pay details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <L id="em-bank" label="Bank account number"><input id="em-bank" disabled={!canEditBank} value={f.bankAccountNumber} onChange={set('bankAccountNumber')} className={field} inputMode="numeric" /></L>
              <L id="em-ifsc" label="IFSC"><input id="em-ifsc" disabled={!canEditBank} value={f.bankIfsc} onChange={set('bankIfsc')} className={field} /></L>
            </div>
          </section>
        )}
        <p className="text-xs text-muted-foreground">
          Every change is kept in the <Link href={`/reports/activity-log?row=${e.id}&table=User`} className="text-brand hover:underline">activity log</Link>.
          Sign-in, password and roles are managed under Settings → Users.
        </p>
      </div>
    </Modal>
  );
}
