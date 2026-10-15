'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import type { RoleRow, PermissionOption, MenuOption } from '@/server/roles';
import {
  createRoleAction, updateRoleAction, deleteRoleAction, loadRoleDetailAction, setRoleDesignationAction,
} from './actions';
import { RolePhoneAppDialog } from '@/components/app-access/PhoneAppDialogs';
import { canOpenRoute } from '@/lib/route-access';
import { RoleAccessEditor } from './RoleAccessEditor';

interface StoreRef { id: string; name: string; branchCode: string }

export function RolesClient({
  roles, permissions, menus, stores, canEdit, appAccess, excludedModules = [], excludedPages = [],
}: {
  /** Modules the platform switched off for this business - not offered in the grid (F-01). */
  excludedModules?: string[];
  /** Individual pages the platform switched off - same, one level down. */
  excludedPages?: string[];
  /** Settings > Roles > Phone app - one line per role for the list. */
  appAccess: Record<string, { summary: string; isPreset: boolean }>;
  roles: RoleRow[];
  permissions: PermissionOption[];
  menus: MenuOption[];
  stores: StoreRef[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [settingDesignation, setSettingDesignation] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [phoneFor, setPhoneFor] = useState<RoleRow | null>(null);

  const visible = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter((r) => r.name.toLowerCase().includes(q) || r.storeName.toLowerCase().includes(q));
  }, [roles, search]);

  const columns: Column<RoleRow>[] = [
    { key: 'name', header: 'Role', render: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name },
    { key: 'store', header: 'Store', render: (r) => <span className="text-xs">{r.storeName}</span>, sortValue: (r) => r.storeName },
    { key: 'description', header: 'Description', render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? '-'}</span>, optional: true },
    {
      key: 'designation', header: 'Designation',
      render: (r) => r.designationCode
        ? <Badge tone="neutral">{r.designationCode}{r.level != null ? ` · L${r.level}` : ''}</Badge>
        : <span className="text-xs text-muted-foreground">-</span>,
      optional: true,
    },
    {
      key: 'phone', header: 'Phone app',
      render: (r) => (
        <button type="button" onClick={() => setPhoneFor(r)} className="text-start text-xs text-brand hover:underline">
          {appAccess[r.id]?.summary ?? '-'}
        </button>
      ),
      sortValue: (r) => appAccess[r.id]?.summary ?? '',
    },
    { key: 'permissions', header: 'Permissions', align: 'end', render: (r) => <span className="font-mono text-xs">{r.permissionCount}</span>, sortValue: (r) => r.permissionCount },
    { key: 'users', header: 'Users', align: 'end', render: (r) => <span className="font-mono text-xs">{r.userCount}</span>, sortValue: (r) => r.userCount, optional: true },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={r.isSystem ? 'info' : 'success'}>{r.isSystem ? 'system' : 'custom'}</Badge>, sortValue: (r) => (r.isSystem ? 1 : 0) },
  ];

  const doDelete = () => {
    if (!deleting) return;
    startTransition(async () => {
      const res = await deleteRoleAction(deleting.id);
      if (res.error) { setDeleteError(res.error); return; }
      setDeleting(null);
      window.location.reload();
    });
  };

  return (
    <div>
      <PageHeader
        badge="RL"
        title="Roles"
        subtitle={`${roles.length} roles`}
        actions={
          canEdit ? (
            <Button variant="primary" icon="user-plus" onClick={() => setCreateOpen(true)}>
              New Role
            </Button>
          ) : undefined
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Role or store…"
        count={`Total (${visible.length})`}
        end={<ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />}
      />

      <DataGrid
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="users"
        emptyMessage="No roles found."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={canEdit ? [
          { label: 'Edit', icon: 'pencil', enabled: (r) => !r.isSystem, onSelect: (r) => setEditing(r) },
          { label: 'Phone app', icon: 'phone', onSelect: (r) => setPhoneFor(r) },
          {
            label: 'Designation', icon: 'tag', enabled: (r) => r.isSystem,
            onSelect: (r) => setSettingDesignation(r),
          },
          { label: 'Delete', icon: 'trash', tone: 'danger', enabled: (r) => !r.isSystem, onSelect: (r) => { setDeleteError(null); setDeleting(r); } },
        ] : []}
      />

      {phoneFor && (
        <RolePhoneAppDialog
          roleId={phoneFor.id}
          onClose={() => setPhoneFor(null)}
          onSaved={() => { setPhoneFor(null); window.location.reload(); }}
        />
      )}

      {createOpen && (
        <RoleDialog
          mode="create"
          copyFrom={roles}
          stores={stores}
          permissions={permissions}
          menus={menus}
          excludedModules={excludedModules}
          excludedPages={excludedPages}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); window.location.reload(); }}
        />
      )}

      {editing && (
        <RoleDialog
          mode="edit"
          role={editing}
          stores={stores}
          permissions={permissions}
          menus={menus}
          excludedModules={excludedModules}
          excludedPages={excludedPages}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); window.location.reload(); }}
        />
      )}

      {settingDesignation && (
        <DesignationDialog
          role={settingDesignation}
          onClose={() => setSettingDesignation(null)}
          onDone={() => { setSettingDesignation(null); window.location.reload(); }}
        />
      )}

      {deleting && (
        <Modal open title={`Delete "${deleting.name}"?`} icon="trash" size="sm" onClose={() => setDeleting(null)}>
          <div className="grid gap-3">
            {deleteError && (
              <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
                <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="primary" icon="trash" disabled={pending} loading={pending} onClick={doDelete}>
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DesignationDialog({ role, onClose, onDone }: { role: RoleRow; onClose: () => void; onDone: () => void }) {
  const [designationCode, setDesignationCode] = useState(role.designationCode ?? '');
  const [level, setLevel] = useState(role.level != null ? String(role.level) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await setRoleDesignationAction(role.id, {
        designationCode: designationCode.trim() || null,
        level: level.trim() ? Number(level) : null,
      });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={`${role.name} - designation`}
      subtitle="How this role's holder shows on Team Setup and the org chart - not their permissions."
      icon="tag"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={pending} loading={pending} onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {role.name} is a system role, so its permissions can&rsquo;t be changed here - but the
          label and seniority it carries on your org chart is entirely yours to set. The person
          with no manager above them (the owner) usually wants their own Admin role to say
          something like &ldquo;Owner&rdquo; or &ldquo;Founder&rdquo; here.
        </p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Designation code
          <input type="text" value={designationCode} onChange={(e) => setDesignationCode(e.target.value)}
            placeholder="e.g. ADMIN, OWNER, CEO"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Org-chart level
          <input type="number" value={level} onChange={(e) => setLevel(e.target.value)}
            placeholder="1 = most senior"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}

function RoleDialog({
  mode, role, stores, permissions, menus, onClose, onDone, copyFrom = [], excludedModules = [],
  excludedPages = [],
}: {
  excludedModules?: string[];
  excludedPages?: string[];
  mode: 'create' | 'edit';
  role?: RoleRow;
  /** New role: other roles whose access can be copied as a starting point. */
  copyFrom?: RoleRow[];
  stores: StoreRef[];
  permissions: PermissionOption[];
  menus: MenuOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [storeId, setStoreId] = useState(role?.storeId ?? stores[0]?.id ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [designationCode, setDesignationCode] = useState(role?.designationCode ?? '');
  const [level, setLevel] = useState(role?.level != null ? String(role.level) : '');
  // Permission KEYS (the grid works in keys) and menus hidden on purpose.
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const keyOf = useMemo(() => new Map(permissions.map((p) => [p.id, p.key])), [permissions]);
  const idOf = useMemo(() => new Map(permissions.map((p) => [p.key, p.id])), [permissions]);
  /** A role's saved access as grid state: the menu entries it may open but
   *  was not shown are the ones deliberately hidden - kept hidden. */
  const adopt = (d: { permissionIds: string[]; menuIds: string[] }) => {
    const k = new Set(d.permissionIds.map((id) => keyOf.get(id)).filter((x): x is string => !!x));
    const visible = new Set(d.menuIds);
    setKeys(k);
    setHidden(new Set(menus.filter((m) => m.route && canOpenRoute(m.route, k) && !visible.has(m.id)).map((m) => m.id)));
  };
  const [loading, setLoading] = useState(mode === 'edit');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (mode !== 'edit' || !role) return;
    void loadRoleDetailAction(role.id).then((detail) => {
      if (detail) {
        adopt(detail);
        setDesignationCode(detail.designationCode ?? '');
        setLevel(detail.level != null ? String(detail.level) : '');
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per role
  }, [mode, role]);

  const ready = name.trim() !== '' && (mode === 'edit' || storeId !== '');

  const save = () => {
    startTransition(async () => {
      const input = {
        name, description: description.trim() || null,
        designationCode: designationCode.trim() || null,
        level: level.trim() ? Number(level) : null,
        permissionIds: [...keys].map((k) => idOf.get(k)).filter((x): x is string => !!x),
        // Menus follow the permissions; only the deliberately hidden ones are left out.
        menuIds: menus.filter((m) => !hidden.has(m.id)).map((m) => m.id),
      };
      const res = mode === 'create'
        ? await createRoleAction({ ...input, storeId })
        : await updateRoleAction(role!.id, input);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={mode === 'create' ? 'New Role' : `Edit "${role?.name}"`}
      subtitle="Pick a level for each area - the menu follows automatically"
      icon="user-plus"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!ready || pending || loading} loading={pending} onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4">
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Role name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Store Manager"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Store
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={mode === 'edit'}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Description
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Designation code
              <input type="text" value={designationCode} onChange={(e) => setDesignationCode(e.target.value)}
                placeholder="e.g. CEO, VP, MGR - optional"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Org-chart level
              <input type="number" value={level} onChange={(e) => setLevel(e.target.value)}
                placeholder="1 = most senior - optional"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
          </div>

          {mode === 'create' && copyFrom.length > 0 && (
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Start from an existing role (optional)
              <select defaultValue="" onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                void loadRoleDetailAction(id).then((detail) => { if (detail) adopt(detail); });
              }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <option value="">Start empty</option>
                {copyFrom.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.storeName})</option>)}
              </select>
            </label>
          )}

          <RoleAccessEditor
            permissions={permissions} menus={menus} keys={keys} setKeys={setKeys}
            hidden={hidden} setHidden={setHidden}
            excludedModules={excludedModules} excludedPages={excludedPages}
          />
        </div>
      )}
    </Modal>
  );
}
