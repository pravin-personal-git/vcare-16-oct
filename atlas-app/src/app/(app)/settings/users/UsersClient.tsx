'use client';

import { UserPhoneAppDialog } from '@/components/app-access/PhoneAppDialogs';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button, buttonClass } from '@/components/ui/Button';
import { whatsappLink } from '@/lib/revenue';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, Card, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { Toolbar } from '@/components/ui/Toolbar';
import type { UserRow } from '@/server/administration';
import { AVATAR_COLOR_OPTIONS } from '@/lib/avatar';
import {
  addUser, editUser, grantRole, issuePassword, revokeRole, setPassword, toggleUserActive, viewPassword,
} from './actions';
import { ACCESS_LABEL, ACCESS_TONE, accessHint, accessState } from '@/lib/password-policy';

/**
 * User administration.
 *
 * Until this screen existed, adding a person to Atlas meant writing SQL. That
 * is workable for one developer and impossible for a client - which made it the
 * thing standing between "a demo" and "a product somebody runs their business
 * on".
 *
 * The seat count in the strip is not decoration. `User.isSeatLicensed` is the
 * commercial metering unit, and the reference app surfaces "TOTAL CRM SEATS"
 * for the same reason: it is what a licence is counted in, so it should be
 * visible before it is invoiced.
 */

interface Props {
  users: UserRow[];
  stores: { id: string; name: string; branchCode: string }[];
  roles: { id: string; storeId: string; name: string; isSystem: boolean }[];
  departments: { id: string; name: string }[];
  canEdit: boolean;
  /** `users.viewPasswords` - shows the Current password box (9 Oct 2026). */
  canViewPasswords: boolean;
  currentUserId: string;
}

type Filter = 'all' | 'active' | 'inactive' | 'unassigned' | 'signedin';

export function UsersClient({
  users, stores, roles, departments, canEdit, canViewPasswords, currentUserId,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rolesForId, setRolesForId] = useState<string | null>(null);
  const [phoneForId, setPhoneForId] = useState<string | null>(null);
  const [pwdForId, setPwdForId] = useState<string | null>(null);
  /**
   * A generated password, held only in this component's state for as long as the
   * dialog is open. Never written anywhere, and gone on close - a second look
   * means a second reset, which is correct, because by then two people have seen
   * the first one.
   */
  const [issued, setIssued] = useState<{ password: string; username: string } | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<UserRow | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) { setError(res.error); return; }
      setNotice(res.message ?? null);
      setAdding(false);
      setEditingId(null);
      setPwdForId(null);
      setConfirmToggle(null);
    });
  };

  /**
   * Generating a password is the one action that keeps its dialog open, because
   * the result IS the dialog - closing it the way `run` does for everything else
   * would show the password for a fraction of a second and then throw it away
   * forever.
   */
  const generate = (userId: string) => {
    setError(null); setNotice(null);
    startTransition(async () => {
      const res = await issuePassword(userId);
      if (res.error) { setError(res.error); return; }
      setNotice(res.message ?? null);
      if (res.password && res.username) {
        setIssued({ password: res.password, username: res.username });
      }
    });
  };

  const closePwd = () => { setPwdForId(null); setIssued(null); setError(null); };

  const cards = useMemo(() => [
    { key: 'all', label: 'Total Users', count: users.length, icon: 'users' as const },
    {
      key: 'active', label: 'Active', tone: 'success' as const, icon: 'check-circle' as const,
      count: users.filter((u) => u.isActive).length,
    },
    {
      key: 'inactive', label: 'Inactive', tone: 'default' as const, icon: 'ban' as const,
      count: users.filter((u) => !u.isActive).length,
    },
    {
      key: 'seats', label: 'Licensed Seats', tone: 'brand' as const, icon: 'user' as const,
      count: users.filter((u) => u.isSeatLicensed && u.isActive).length,
      subLabel: 'billable',
    },
    {
      key: 'unassigned', label: 'No Role', tone: 'warning' as const, icon: 'alert-triangle' as const,
      count: users.filter((u) => u.assignments.length === 0).length,
      subLabel: 'cannot sign in',
    },
    {
      key: 'signedin', label: 'Signed In Now', tone: 'info' as const, icon: 'lock' as const,
      count: users.filter((u) => u.activeSessions > 0).length,
    },
  ], [users]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'active' && !u.isActive) return false;
      if (filter === 'inactive' && u.isActive) return false;
      if (filter === 'unassigned' && u.assignments.length > 0) return false;
      if (filter === 'signedin' && u.activeSessions === 0) return false;
      if (!q) return true;
      return [u.fullName, u.username, u.email, u.phone, u.userCode]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [users, search, filter]);

  const editing = users.find((u) => u.id === editingId) ?? null;
  const managingRoles = users.find((u) => u.id === rolesForId) ?? null;
  const resettingPwd = users.find((u) => u.id === pwdForId) ?? null;

  return (
    <div>
      <PageHeader
        badge="UL"
        title="User List"
        subtitle={`${users.length} people · ${users.filter((u) => u.isSeatLicensed && u.isActive).length} licensed seats`}
        actions={
          canEdit ? (
            // Every login is an employee (Pravin, P3, 11 Oct 2026): a new
            // person is added with their employee record, on People.
            <Button variant="primary" icon="user-plus" onClick={() => { window.location.href = '/settings/people?add=1'; }}>
              Add User
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {notice && (
        <Card className="mb-3 border-success/40 bg-success/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{notice}</span>
          </p>
        </Card>
      )}

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name, username, email, phone…"
        count={<span className="text-sm text-muted-foreground">{visible.length} shown</span>}
      />

      <KpiStrip
        cards={cards}
        activeKey={filter === 'all' ? null : filter}
        onSelect={(k) => setFilter((k as Filter) ?? 'all')}
        columns={6}
      />

      <SectionCard title="Users" icon="users" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Username</th>
                <th className="px-4 py-2 font-semibold">Contact</th>
                <th className="px-4 py-2 font-semibold">Roles</th>
                <th className="px-4 py-2 font-semibold">Last sign-in</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="w-32 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No users match.
                  </td>
                </tr>
              )}

              {visible.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-border last:border-0 ${u.isActive ? '' : 'bg-muted/30'}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {u.fullName}
                      {u.id === currentUserId && (
                        <span className="ms-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.userCode}
                      {u.departmentName ? ` · ${u.departmentName}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    <div>{u.email ?? '-'}</div>
                    {u.phone && <div className="text-xs">{u.phone}</div>}
                  </td>
                  <td className="px-4 py-2">
                    {u.assignments.length === 0 ? (
                      <Badge tone="warning" icon="alert-triangle">No role - cannot sign in</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.assignments.slice(0, 3).map((a) => (
                          <Badge key={`${a.storeId}:${a.roleId}`} tone="neutral">
                            {a.roleName}
                            <span className="opacity-60"> · {a.storeName}</span>
                          </Badge>
                        ))}
                        {u.assignments.length > 3 && (
                          <Badge tone="neutral">+{u.assignments.length - 3}</Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
                      day: '2-digit', month: 'short', year: 'numeric',
                    }) : 'Never'}
                    {u.activeSessions > 0 && (
                      <span className="ms-1.5 text-xs text-success">
                        · {u.activeSessions} open
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {/*
                      "Can this person get in, and if not why not" - which is the
                      question behind "what is their password?". Atlas held every
                      one of these facts and showed none of them, so the only way
                      to find out was to reset the password and ask.
                    */}
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        tone={ACCESS_TONE[accessState(u)]}
                        title={accessHint(u) ?? undefined}
                      >
                        {ACCESS_LABEL[accessState(u)]}
                      </Badge>
                      {!u.isSeatLicensed && <Badge tone="neutral">Unlicensed</Badge>}
                    </div>
                    {accessHint(u) && (
                      <p className="mt-0.5 max-w-[16rem] text-xs leading-snug text-muted-foreground">
                        {accessHint(u)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn label="Edit details" icon="pencil" onClick={() => setEditingId(u.id)} />
                        <IconBtn label="Roles and stores" icon="users" onClick={() => setRolesForId(u.id)} />
                        <IconBtn label="Phone app" icon="phone" onClick={() => setPhoneForId(u.id)} />
                        <IconBtn label="Reset password" icon="lock" onClick={() => { setIssued(null); setPwdForId(u.id); }} />
                        <IconBtn
                          label={u.isActive ? 'Deactivate' : 'Reactivate'}
                          icon={u.isActive ? 'ban' : 'check'}
                          danger={u.isActive}
                          disabled={u.id === currentUserId && u.isActive}
                          title={
                            u.id === currentUserId && u.isActive
                              ? 'You cannot deactivate your own account'
                              : undefined
                          }
                          onClick={() => setConfirmToggle(u)}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          A user with no role can sign in and see nothing - the session resolves to no store, and
          they land back on the login screen. Deactivating someone ends every open session
          immediately rather than waiting for the cookie to expire.
        </p>
      </SectionCard>

      {phoneForId && users.find((x) => x.id === phoneForId) && (
        <UserPhoneAppDialog user={users.find((x) => x.id === phoneForId)!} onClose={() => setPhoneForId(null)} />
      )}

      {(adding || editing) && (
        <UserForm
          user={editing}
          stores={stores}
          roles={roles}
          departments={departments}
          busy={pending}
          onClose={() => { setAdding(false); setEditingId(null); setError(null); }}
          onSubmit={(values) =>
            run(() =>
              editing
                ? editUser(editing.id, {
                  fullName: values.fullName,
                  email: values.email,
                  phone: values.phone,
                  departmentId: values.departmentId,
                  isSeatLicensed: values.isSeatLicensed,
                  avatarColor: values.avatarColor,
                })
                : addUser(values),
            )
          }
        />
      )}

      {managingRoles && (
        <RoleAssignments
          user={managingRoles}
          stores={stores}
          roles={roles}
          busy={pending}
          onClose={() => { setRolesForId(null); setError(null); }}
          onGrant={(storeId, roleId) => run(() => grantRole(managingRoles.id, storeId, roleId))}
          onRevoke={(storeId, roleId) => run(() => revokeRole(managingRoles.id, storeId, roleId))}
        />
      )}

      {resettingPwd && (
        <PasswordForm
          user={resettingPwd}
          busy={pending}
          canViewPasswords={canViewPasswords}
          issued={issued}
          onClose={closePwd}
          onGenerate={() => generate(resettingPwd.id)}
          onSubmit={(pwd) => run(() => setPassword(resettingPwd.id, pwd))}
        />
      )}

      {confirmToggle && (
        <ConfirmDialog
          title={confirmToggle.isActive
            ? `Deactivate ${confirmToggle.fullName}?`
            : `Reactivate ${confirmToggle.fullName}?`}
          message={confirmToggle.isActive
            ? 'They will be signed out of every device immediately and will not be able to sign in again until reactivated. Nothing they created is deleted.'
            : 'They will be able to sign in again with their existing password and roles.'}
          confirmLabel={confirmToggle.isActive ? 'Deactivate' : 'Reactivate'}
          tone={confirmToggle.isActive ? 'danger' : 'brand'}
          busy={pending}
          onConfirm={() => run(() => toggleUserActive(confirmToggle.id, !confirmToggle.isActive))}
          onClose={() => setConfirmToggle(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IconBtn({
  label, icon, onClick, danger, disabled, title,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${
        danger ? 'hover:bg-danger/10 hover:text-danger' : ''
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

interface UserValues {
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  password: string;
  isSeatLicensed: boolean;
  avatarColor: string | null;
  assignments: { storeId: string; roleId: string }[];
}

function UserForm({
  user, stores, roles, departments, busy, onClose, onSubmit,
}: {
  user: UserRow | null;
  stores: { id: string; name: string }[];
  roles: { id: string; storeId: string; name: string }[];
  departments: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: UserValues) => void;
}) {
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [password, setPassword] = useState('');
  const [licensed, setLicensed] = useState(user?.isSeatLicensed ?? true);
  const [avatarColor, setAvatarColor] = useState<string | null>(user?.avatarColor ?? null);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [roleId, setRoleId] = useState('');

  const storeRoles = roles.filter((r) => r.storeId === storeId);
  const effectiveRoleId = roleId && storeRoles.some((r) => r.id === roleId)
    ? roleId
    : storeRoles[0]?.id ?? '';

  const valid = fullName.trim()
    && (user || (username.trim() && password.length >= 12 && effectiveRoleId));

  return (
    <Modal
      title={user ? `Edit ${user.fullName}` : 'Add User'}
      subtitle={user ? undefined : 'They can sign in as soon as you save.'}
      icon="user-plus"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={() => onSubmit({
              fullName: fullName.trim(),
              username: username.trim(),
              email: email.trim() || null,
              phone: phone.trim() || null,
              departmentId: departmentId || null,
              password,
              isSeatLicensed: licensed,
              avatarColor,
              assignments: effectiveRoleId ? [{ storeId, roleId: effectiveRoleId }] : [],
            })}
          >
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required htmlFor="u-name" className="sm:col-span-2">
          <input id="u-name" value={fullName} autoFocus
            onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </Field>

        {!user && (
          <>
            <Field label="Username" required hint="Lower-case. This is what they type to sign in." htmlFor="u-username">
              <input id="u-username" value={username}
                onChange={(e) => setUsername(e.target.value)} className={inputClass} />
            </Field>
            <Field
              label="Password"
              required
              hint="At least 12 characters. Tell them directly - there is no reset email yet."
              htmlFor="u-pwd"
            >
              <input id="u-pwd" type="text" value={password}
                onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}

        <Field label="Email" htmlFor="u-email">
          <input id="u-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone" htmlFor="u-phone">
          <input id="u-phone" value={phone}
            onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>

        {departments.length > 0 && (
          <Field label="Department" htmlFor="u-dept">
            <select id="u-dept" value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
              <option value="">-</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Seat" hint="Unlicensed users still work; they are not counted for billing.">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={licensed}
              onChange={(e) => setLicensed(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong accent-brand" />
            Counts as a licensed seat
          </label>
        </Field>

        <Field label="Avatar colour" hint="Shown instead of the automatic colour, everywhere this person's initials appear." className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {AVATAR_COLOR_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                title={o.label}
                aria-label={o.label}
                onClick={() => setAvatarColor(o.key)}
                className={`h-7 w-7 rounded-full ${o.className} transition ${
                  avatarColor === o.key ? 'ring-2 ring-offset-2 ring-foreground' : 'opacity-70 hover:opacity-100'
                }`}
              />
            ))}
            <button
              type="button"
              onClick={() => setAvatarColor(null)}
              className={`ms-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                avatarColor === null ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              Automatic
            </button>
          </div>
        </Field>

        {!user && (
          <div className="sm:col-span-2">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Give them a store and a role. Without one they can sign in and see nothing - add
                more from the roles button afterwards.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Store" required htmlFor="u-store">
                  <select id="u-store" value={storeId}
                    onChange={(e) => { setStoreId(e.target.value); setRoleId(''); }}
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Role" required htmlFor="u-role">
                  <select id="u-role" value={effectiveRoleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
                    {storeRoles.length === 0 && <option value="">No roles in this store</option>}
                    {storeRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RoleAssignments({
  user, stores, roles, busy, onClose, onGrant, onRevoke,
}: {
  user: UserRow;
  stores: { id: string; name: string }[];
  roles: { id: string; storeId: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onGrant: (storeId: string, roleId: string) => void;
  onRevoke: (storeId: string, roleId: string) => void;
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [roleId, setRoleId] = useState('');

  const held = new Set(user.assignments.map((a) => `${a.storeId}:${a.roleId}`));
  const available = roles.filter((r) => r.storeId === storeId && !held.has(`${storeId}:${r.id}`));
  const effectiveRoleId = roleId && available.some((r) => r.id === roleId)
    ? roleId
    : available[0]?.id ?? '';

  return (
    <Modal
      title={`Roles - ${user.fullName}`}
      subtitle="A person may hold several roles in several stores. Permissions are the union of all of them."
      icon="users"
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="grid gap-4">
        <div className="rounded-lg border border-border">
          {user.assignments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No roles yet - this account can sign in but will see nothing.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Store</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {user.assignments.map((a) => (
                  <tr key={`${a.storeId}:${a.roleId}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{a.storeName}</td>
                    <td className="px-3 py-2 font-medium">{a.roleName}</td>
                    <td className="px-3 py-2">
                      <IconBtn
                        label={`Remove ${a.roleName} in ${a.storeName}`}
                        icon="x"
                        danger
                        disabled={busy}
                        onClick={() => onRevoke(a.storeId, a.roleId)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Grant another
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Store" className="min-w-[10rem] flex-1" htmlFor="ra-store">
              <select id="ra-store" value={storeId}
                onChange={(e) => { setStoreId(e.target.value); setRoleId(''); }}
                className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Role" className="min-w-[10rem] flex-1" htmlFor="ra-role">
              <select id="ra-role" value={effectiveRoleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
                {available.length === 0 && <option value="">Nothing left to grant here</option>}
                {available.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Button
              variant="primary"
              icon="plus"
              loading={busy}
              disabled={!effectiveRoleId}
              onClick={() => onGrant(storeId, effectiveRoleId)}
            >
              Grant
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Reset somebody's password without inventing one (3 Oct 2026).
 *
 * WHY THERE IS NO "SHOW THEIR PASSWORD" HERE.
 *
 * The request was a screen listing each employee's password, so an admin would
 * not have to keep resetting them. Passwords are not stored: `passwordHash` is a
 * one-way scrypt fingerprint, so there is nothing to show - and storing them
 * reversibly would mean one database leak handing over every employee's
 * password, which people reuse on their bank.
 *
 * The real complaint - "I have to think of a password and type it every time" -
 * is what this fixes. One button. Atlas generates a strong one, shows it once to
 * read out, and the person is made to choose their own as soon as they sign in.
 *
 * Typing one by hand is still here, below the generated option, because
 * sometimes somebody is standing next to you and a password they chose
 * themselves is easier. Either way the account is flagged and they replace it.
 *
 * 9 OCT 2026 - BOTH OF THE ABOVE CHANGED, ON PURPOSE. Vcare's admin still
 * wanted to see passwords, and Pravin decided to build it with guard rails
 * (server/password-copy.ts): a sealed copy, admin-only, own password first,
 * every look logged. With that, forcing a change at first sign-in was
 * dropped too (his option b) - the password the admin sets stays the
 * password. So: reset in one tap, send on WhatsApp or copy, and the Current
 * password box above the reset shows it again later.
 */

/** Everything they need to get in, in one message: where, who, what. */
function signInMessage(fullName: string, username: string, password: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `Hi ${fullName}, your Atlas sign-in:\nLink: ${origin}/login\n`
    + `Username: ${username}\nPassword: ${password}`;
}

/** No number on file: open WhatsApp on its contact picker rather than nowhere. */
function sendHref(phone: string | null, message: string): string {
  return whatsappLink(phone, message);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access is refused in some browsers and app views. The
    // password is on screen in a selectable box either way.
    return false;
  }
}

/**
 * The admin's view of a user's current password (Vcare, 9 Oct 2026).
 *
 * Hidden until asked for. The first look in 15 minutes asks for the admin's
 * own password; the server logs every look. It hides itself again after 30
 * seconds, so it is not left on a screen somebody walks past.
 */
function CurrentPasswordBox({ user }: { user: UserRow }) {
  const [phase, setPhase] = useState<'hidden' | 'ask' | 'shown'>('hidden');
  const [mine, setMine] = useState('');
  const [shown, setShown] = useState<{ password: string; setAt: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (phase !== 'shown') return;
    const t = window.setTimeout(() => { setPhase('hidden'); setShown(null); }, 30_000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const reveal = (myPassword: string) => start(async () => {
    setNote(null);
    const r = await viewPassword(user.id, myPassword);
    if (r.needsMyPassword) { setPhase('ask'); setNote(r.error ?? null); return; }
    if (r.error) { setNote(r.error); return; }
    setMine('');
    if (r.state === 'ok' && r.password && r.setAt) {
      // Cleared here as well as above: the update before the await does not
      // always survive the transition, and a stale "not your password" under
      // the password that just appeared reads as a failure.
      setNote(null);
      setShown({ password: r.password, setAt: r.setAt });
      setPhase('shown');
      return;
    }
    setPhase('hidden');
    setNote(
      r.state === 'no_key'
        ? 'This Atlas is not set up to keep passwords (ATLAS_SECRET_KEY is missing on the server). Ask N.A.I.R. Solutions.'
        : r.state === 'stale'
          ? 'The saved copy is out of date - this password was changed somewhere that does not keep one. Reset it once below.'
          : 'Not available yet. Atlas keeps a password from the next time it is set - reset it once below, and from then on it shows here.',
    );
  });

  const message = shown ? signInMessage(user.fullName, user.username, shown.password) : '';

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Current password</p>
        {phase === 'shown' ? (
          <Button size="sm" icon="eye-off" onClick={() => { setPhase('hidden'); setShown(null); }}>Hide</Button>
        ) : phase === 'hidden' ? (
          <Button size="sm" icon="eye" loading={pending} onClick={() => reveal('')}>Show</Button>
        ) : null}
      </div>

      {phase === 'hidden' && !note && (
        <p className="mt-1 font-mono text-lg tracking-widest text-muted-foreground">●●●●●●●●●●</p>
      )}

      {phase === 'ask' && (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(e) => { e.preventDefault(); if (mine) reveal(mine); }}
        >
          <Field label="Your own password" hint="Asked once every 15 minutes. Every look is recorded." htmlFor="pw-mine">
            {/* autoComplete current-password: this IS the admin's own login. */}
            <input id="pw-mine" type="password" autoComplete="current-password" autoFocus
              value={mine} onChange={(e) => setMine(e.target.value)} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" icon="eye" loading={pending} disabled={!mine}>Show password</Button>
            <Button type="button" onClick={() => { setPhase('hidden'); setMine(''); setNote(null); }}>Cancel</Button>
          </div>
        </form>
      )}

      {phase === 'shown' && shown && (
        <div className="mt-1 grid gap-2">
          <p className="select-all font-mono text-xl font-bold tracking-wide">{shown.password}</p>
          <p className="text-xs text-muted-foreground">
            Set {new Date(shown.setAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}.
            Hides itself in 30 seconds.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={sendHref(user.phone, message)} target="_blank" rel="noopener noreferrer"
              className={`${buttonClass('primary', 'sm')} gap-1.5`}>
              <Icon name="whatsapp" />
              {user.phone ? `WhatsApp to ${user.phone}` : 'Send on WhatsApp'}
            </a>
            <Button size="sm" icon="copy" onClick={async () => {
              setCopied(await copyText(message));
              window.setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function PasswordForm({
  user, busy, canViewPasswords, issued, onClose, onSubmit, onGenerate,
}: {
  user: UserRow;
  busy: boolean;
  canViewPasswords: boolean;
  /** Set once a generated password comes back. Shown, then gone forever. */
  issued: { password: string; username: string } | null;
  onClose: () => void;
  onSubmit: (password: string) => void;
  onGenerate: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [copied, setCopied] = useState(false);

  const message = issued ? signInMessage(user.fullName, issued.username, issued.password) : '';
  const waHref = sendHref(user.phone, message);

  const copy = async () => {
    if (!issued) return;
    setCopied(await copyText(message));
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (issued) {
    return (
      <Modal
        title={`Password for ${user.fullName}`}
        subtitle="Send it or read it out now. This is their password until it is changed."
        icon="lock"
        tone="accent"
        size="md"
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      >
        <div className="grid gap-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
              Username
            </p>
            <p className="font-mono text-base font-semibold">{issued.username}</p>
            <p className="mt-2.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
              Password
            </p>
            {/*
              Selectable text, not an input: nothing should autofill or save it,
              and a password manager offering to remember somebody else's
              password is the opposite of what is wanted here.
            */}
            <p className="select-all font-mono text-xl font-bold tracking-wide">{issued.password}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonClass('primary')} gap-1.5`}
            >
              <Icon name="whatsapp" />
              {user.phone ? `WhatsApp to ${user.phone}` : 'Send on WhatsApp'}
            </a>
            <Button icon="copy" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Both send the link, username and password together.
            </span>
          </div>

          <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed">
            {canViewPasswords
              ? <>Lost it? Open Reset password for {user.fullName} again and use <strong>Show</strong> under Current password &mdash; no need to reset.</>
              : <>If this one is lost, reset it again.</>}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Reset the password for ${user.fullName}`}
      subtitle="Every open session for this user ends immediately."
      icon="lock"
      tone="accent"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="accent" loading={busy} disabled={pwd.length < 12}
            onClick={() => onSubmit(pwd)}>
            Use the one I typed
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {canViewPasswords && <CurrentPasswordBox user={user} />}

        <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
          <p className="text-sm font-semibold">Let Atlas pick one</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            A strong password with no look-alike characters, so it survives being read down a
            phone line.
          </p>
          <Button className="mt-2" variant="primary" icon="refresh" loading={busy} onClick={onGenerate}>
            Reset and make a new password
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Next screen: send it on WhatsApp or copy it, in one tap.
          </p>
        </div>

        <Field
          label="Or type one yourself"
          hint="At least 12 characters."
          htmlFor="pw-new"
        >
          <input id="pw-new" type="text" value={pwd}
            onChange={(e) => setPwd(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}
