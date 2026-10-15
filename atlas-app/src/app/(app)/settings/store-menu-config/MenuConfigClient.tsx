'use client';
import { TreeSearchBar, useTreeSearch } from '@/components/ui/TreeSearch';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge, Card, PageHeader, SectionCard } from '@/components/ui/Layout';
import type { MenuNodeConfig } from '@/server/administration';
import { loadUserOverridesAction, showOnlyBuilt, toggleRoleMenu, toggleStoreMenu, toggleUserMenu } from './actions';

/**
 * The two-tier menu gate, as a matrix.
 *
 *     effective_menus = store_config ∩ (⋃ role_config for the user's roles)
 *
 * The store column is the outer bound and the role columns narrow within it,
 * so a role checkbox is **disabled while its store row is off** - that is the
 * rule made visible rather than explained in a paragraph nobody reads. Turning
 * a store row off greys its whole line, which is exactly what happens to the
 * menu.
 *
 * Parent rows cascade to their children, because a child enabled under a
 * disabled parent is a route nobody can navigate to and the next person reading
 * the config cannot tell what was meant.
 */

interface Props {
  nodes: MenuNodeConfig[];
  roles: { id: string; name: string; isSystem: boolean }[];
  users: { id: string; fullName: string }[];
  builtRoutes: string[];
  canEdit: boolean;
  scopeIsAll: boolean;
  storeName: string;
}

export function MenuConfigClient({
  nodes, roles, users, builtRoutes, canEdit, scopeIsAll, storeName,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const built = useMemo(() => new Set(builtRoutes), [builtRoutes]);

  /**
   * Search that keeps the tree (F1b / D17). A menu item found without its
   * group is unplaceable - "Sales Target" on its own tells you nothing about
   * where to look for it - so `useTreeSearch` keeps a match's parent, and a
   * matched group keeps its children.
   */
  const menuSearch = useTreeSearch(
    useMemo(
      () => nodes.map((n) => ({ id: n.id, parentId: n.parentId, terms: [n.label, n.route] })),
      [nodes],
    ),
  );

  /** Parents in sort order, each followed by its children. */
  const tree = useMemo(() => {
    const keep = menuSearch.keep;
    const visible = keep ? nodes.filter((n) => keep.has(n.id)) : nodes;
    const roots = visible.filter((n) => !n.parentId).sort((a, b) => a.sort - b.sort);
    return roots.map((root) => ({
      root,
      children: visible.filter((n) => n.parentId === root.id).sort((a, b) => a.sort - b.sort),
    }));
  }, [nodes, menuSearch.keep]);

  const stats = useMemo(() => {
    const leaves = nodes.filter((n) => n.route);
    return {
      on: nodes.filter((n) => n.storeEnabled).length,
      total: nodes.length,
      liveOn: leaves.filter((n) => n.storeEnabled && built.has(n.route!)).length,
      shellOn: leaves.filter((n) => n.storeEnabled && !built.has(n.route!)).length,
    };
  }, [nodes, built]);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setConfirmReset(false);
        if (res.message) setNotice(res.message);
      }
    });
  };

  const isBuilt = (n: MenuNodeConfig) => (n.route ? built.has(n.route) : true);

  return (
    <div>
      <PageHeader
        badge="RM"
        title="Role &amp; User Menu"
        subtitle={
          scopeIsAll
            ? 'Which menus a store enables, and which a role can see'
            : `Which menus a store enables, and which a role can see · ${storeName}`
        }
        actions={
          canEdit && !scopeIsAll ? (
            <Button variant="accent" icon="sparkles" onClick={() => setConfirmReset(true)}>
              Show only what works
            </Button>
          ) : undefined
        }
      />

      {scopeIsAll && (
        <Card className="mb-3 border-warning/40 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <strong>All Company</strong> - the menu is configured per branch. Select a single
              store to edit it.
            </span>
          </p>
        </Card>
      )}

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

      {!scopeIsAll && stats.shellOn > 0 && (
        <Card className="mb-3 border-warning/40 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <strong>{stats.shellOn} enabled menu{stats.shellOn === 1 ? '' : 's'} lead
              nowhere.</strong>{' '}
              The screen renders and explains what it will do, but nothing happens. A client who
              clicks one finds an empty room - and after that they doubt the parts that work.
              <em> Show only what works</em> turns these off in one step; turn each back on as its
              module ships.
            </span>
          </p>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone="info">{stats.on} of {stats.total} menus enabled</Badge>
        <Badge tone="success">{stats.liveOn} lead to a working screen</Badge>
        {stats.shellOn > 0 && <Badge tone="warning">{stats.shellOn} lead to a placeholder</Badge>}
        <Badge tone="neutral">{roles.length} role{roles.length === 1 ? '' : 's'}</Badge>
      </div>

      <SectionCard title="Menu visibility" icon="menu" bodyClassName="p-0">
        <TreeSearchBar search={menuSearch} placeholder="Menu item or route…" noun="menu items" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2 font-semibold">Menu</th>
                <th className="px-3 py-2 text-center font-semibold" title="The outer bound">
                  Store
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="px-3 py-2 text-center font-semibold">
                    <span className="block truncate" title={r.name}>{r.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tree.map(({ root, children }) => (
                <MenuGroup
                  key={root.id}
                  root={root}
                  items={children}
                  roles={roles}
                  isBuilt={isBuilt}
                  canEdit={canEdit && !scopeIsAll}
                  busy={pending}
                  onStore={(id, v) => run(() => toggleStoreMenu(id, v))}
                  onRole={(roleId, id, v) => run(() => toggleRoleMenu(roleId, id, v))}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <p className="mb-1">
            <strong className="text-foreground">Store</strong> is the outer bound - does this branch
            use the module at all. <strong className="text-foreground">Role</strong> narrows within
            it. A role cannot reveal something the store has switched off, which is why a role box
            is disabled while the store box is clear.
          </p>
          <p>
            Toggling a group carries its children with it. A dotted underline marks a menu whose
            screen is still a placeholder.
          </p>
        </div>
      </SectionCard>

      {!scopeIsAll && users.length > 0 && (
        <div className="mt-4">
          <UserOverridesCard nodes={nodes} users={users} canEdit={canEdit} onNotice={setNotice} onError={setError} />
        </div>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Show only what works?"
          message={
            <span>
              Every menu whose screen is built stays on. The{' '}
              <strong>{stats.shellOn} that lead to a placeholder</strong> are switched off, for the
              store and for every role in it.
              <br />
              <br />
              Nothing is deleted - turn any of them back on from this screen whenever you want.
            </span>
          }
          confirmLabel="Apply"
          busy={pending}
          onConfirm={() => run(() => showOnlyBuilt(builtRoutes))}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MenuGroup({
  root, items, roles, isBuilt, canEdit, busy, onStore, onRole,
}: {
  root: MenuNodeConfig;
  /** Named `items`, not `children` - React reserves that prop name. */
  items: MenuNodeConfig[];
  roles: { id: string; name: string }[];
  isBuilt: (n: MenuNodeConfig) => boolean;
  canEdit: boolean;
  busy: boolean;
  onStore: (menuId: string, v: boolean) => void;
  onRole: (roleId: string, menuId: string, v: boolean) => void;
}) {
  const [open, setOpen] = useState(true);

  const rows = [root, ...(open ? items : [])];

  return (
    <>
      {rows.map((node) => {
        const isRoot = node.id === root.id;
        const off = !node.storeEnabled;
        const shell = !isBuilt(node);

        return (
          <tr
            key={node.id}
            className={`border-b border-border last:border-0 ${
              isRoot ? 'bg-muted/20 font-semibold' : ''
            } ${off ? 'text-muted-foreground' : ''}`}
          >
            <td
              className={`sticky left-0 z-10 px-4 py-1.5 ${
                isRoot ? 'bg-muted/20' : 'bg-card'
              } ${off ? 'text-muted-foreground' : ''}`}
            >
              <span className={`flex items-center gap-1.5 ${isRoot ? '' : 'ps-5'}`}>
                {isRoot && items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-label={open ? `Collapse ${root.label}` : `Expand ${root.label}`}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
                  >
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} className="h-3.5 w-3.5" />
                  </button>
                )}
                <span
                  className={shell ? 'underline decoration-warning decoration-dotted underline-offset-4' : ''}
                  title={shell ? 'This screen is still a placeholder' : node.route ?? undefined}
                >
                  {node.label}
                </span>
                {shell && !isRoot && (
                  <Icon name="alert-triangle" className="h-3 w-3 shrink-0 text-warning" />
                )}
              </span>
            </td>

            <td className="px-3 py-1.5 text-center">
              <Toggle
                checked={node.storeEnabled}
                disabled={!canEdit || busy}
                label={`${node.label} enabled for this store`}
                onChange={(v) => onStore(node.id, v)}
              />
            </td>

            {roles.map((r) => (
              <td key={r.id} className="px-3 py-1.5 text-center">
                <Toggle
                  checked={node.roleVisible[r.id] ?? false}
                  disabled={!canEdit || busy || !node.storeEnabled}
                  label={`${node.label} visible to ${r.name}`}
                  title={
                    node.storeEnabled
                      ? undefined
                      : 'The store has this menu switched off - a role cannot reveal it'
                  }
                  onChange={(v) => onRole(r.id, node.id, v)}
                />
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

/**
 * A third tier, layered on the store×role matrix above: hide or show one
 * menu for one specific person without touching their role. "Inherit"
 * means no override row exists - deleting it, not setting it false, is
 * what puts a menu back under role control.
 */
function UserOverridesCard({
  nodes, users, canEdit, onNotice, onError,
}: {
  nodes: MenuNodeConfig[];
  users: { id: string; fullName: string }[];
  canEdit: boolean;
  onNotice: (m: string | null) => void;
  onError: (m: string | null) => void;
}) {
  const [userId, setUserId] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const pickUser = (id: string) => {
    setUserId(id);
    setOverrides(null);
    if (!id) return;
    setLoading(true);
    startTransition(async () => {
      const res = await loadUserOverridesAction(id);
      if ('error' in res) { onError(res.error); setLoading(false); return; }
      setOverrides(res.overrides);
      setLoading(false);
    });
  };

  const setOverride = (menuId: string, value: boolean | null) => {
    if (!userId) return;
    onError(null); onNotice(null);
    setOverrides((o) => {
      const next = { ...(o ?? {}) };
      if (value === null) delete next[menuId]; else next[menuId] = value;
      return next;
    });
    startTransition(async () => {
      const res = await toggleUserMenu(userId, menuId, value);
      if (res.error) onError(res.error);
      else if (res.message) onNotice(res.message);
    });
  };

  return (
    <SectionCard title="Per-user overrides" icon="user" bodyClassName="p-0">
      <div className="border-b border-border p-4">
        <select
          value={userId}
          onChange={(e) => pickUser(e.target.value)}
          disabled={!canEdit}
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand disabled:opacity-60"
        >
          <option value="">Choose a person…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Still bounded by the store column above - an override can never show a menu the store has switched off.
        </p>
      </div>

      {userId && (
        loading || overrides === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {nodes.map((n) => {
              const state = overrides[n.id];
              return (
                <div key={n.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 last:border-0">
                  <span className={`min-w-0 truncate text-sm ${n.parentId ? 'ps-4 text-muted-foreground' : 'font-medium'}`}>
                    {n.label}
                  </span>
                  <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border">
                    {([
                      { key: 'inherit', label: 'Inherit', value: null },
                      { key: 'show', label: 'Show', value: true },
                      { key: 'hide', label: 'Hide', value: false },
                    ] as const).map((opt) => {
                      const active = opt.value === null ? state === undefined : state === opt.value;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          disabled={!canEdit || pending}
                          onClick={() => setOverride(n.id, opt.value)}
                          className={`h-7 px-2 text-xs font-medium transition disabled:opacity-60 ${
                            active ? 'bg-brand text-brand-fg' : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </SectionCard>
  );
}

function Toggle({
  checked, disabled, label, title, onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  title?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={title}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer rounded border-border-strong text-brand accent-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-30"
    />
  );
}
