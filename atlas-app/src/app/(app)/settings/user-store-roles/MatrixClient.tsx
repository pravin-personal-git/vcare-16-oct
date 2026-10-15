'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { grantAction, revokeAction } from './actions';

/**
 * The user × store × role matrix.
 *
 * ONE BRANCH AT A TIME, NOT ALL OF THEM AT ONCE.
 *
 * A grid of every person against every role in every branch is unreadable past
 * about two branches, and this product is built for companies with twelve. So
 * the branch is a selector and the grid underneath is people down, roles across
 * - which is the question an administrator actually has: "in THIS branch, who
 * can do what".
 *
 * ROLES ARE A UNION, NOT A CHOICE.
 *
 * A person can hold several roles in one branch and their permissions are the
 * union. That is why each cell is a checkbox and not a radio button, and why
 * a row with three ticks is normal rather than a mistake.
 */

interface UserLite {
  id: string;
  fullName: string;
  username: string;
  departmentName: string | null;
  isActive: boolean;
  assignments: { storeId: string; storeName: string; roleId: string; roleName: string }[];
}

export function MatrixClient({
  users, stores, roles, canEdit, currentUserId,
}: {
  users: UserLite[];
  stores: { id: string; name: string; branchCode: string }[];
  roles: { id: string; storeId: string; name: string; isSystem: boolean }[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const storeRoles = useMemo(
    () => roles.filter((r) => r.storeId === storeId),
    [roles, storeId],
  );

  const held = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      for (const a of u.assignments) set.add(`${u.id}|${a.storeId}|${a.roleId}`);
    }
    return set;
  }, [users]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((u) => !needle || u.fullName.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
      .filter((u) => !onlyAssigned || u.assignments.some((a) => a.storeId === storeId))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName));
  }, [users, query, onlyAssigned, storeId]);

  const toggle = (userId: string, roleId: string, has: boolean) => {
    if (!canEdit || pending) return;
    const key = `${userId}|${roleId}`;
    setBusyCell(key);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = has
        ? await revokeAction(userId, storeId, roleId)
        : await grantAction(userId, storeId, roleId);
      setBusyCell(null);
      if (res.error) setError(res.error);
      else setNotice(res.message ?? null);
    });
  };

  const storeName = stores.find((s) => s.id === storeId)?.name ?? '';
  const assignedHere = users.filter((u) => u.assignments.some((a) => a.storeId === storeId)).length;

  return (
    <div>
      <PageHeader
        badge="UR"
        title="User store roles"
        subtitle="Who holds which role, in which branch"
      />

      {stores.length === 0 ? (
        <Card>
          <EmptyState icon="building" title="No branches" hint="Create a branch before assigning roles." />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.branchCode})</option>
              ))}
            </select>

            <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
              <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a person…"
                className="h-9 w-full rounded-lg border border-border bg-card ps-9 pe-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <button
              type="button"
              onClick={() => setOnlyAssigned((v) => !v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
                onlyAssigned ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon name="filter" className="h-4 w-4" />
              In this branch
              <span className="text-muted-foreground">({assignedHere})</span>
            </button>
          </div>

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

          {!canEdit && (
            <p className="mb-3 text-xs text-muted-foreground">
              You can see these assignments but not change them.
            </p>
          )}

          {storeRoles.length === 0 ? (
            <Card>
              <EmptyState
                icon="lock"
                title={`${storeName} has no roles yet`}
                hint="Roles are created per branch. Add one on the Users screen before assigning anybody."
              />
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {/* F1b / D17. A role matrix is one row per person in the branch;
                  on a forty-person branch, finding somebody meant scrolling a
                  wide grid sideways and down at the same time. */}
              <ListFilter
                rows={rows}
                noun="people"
                placeholder="Person or username…"
                searchOn={(u) => [u.fullName, u.username]}
                chipOf={(u) => (u.isActive ? 'active' : 'inactive')}
                chipLabel="Status"
                chips={[
                  { value: 'active', label: 'Active', count: rows.filter((u) => u.isActive).length },
                  { value: 'inactive', label: 'Inactive', count: rows.filter((u) => !u.isActive).length },
                ]}
              >
                {(shown) => (shown.length === 0 ? (
                  <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see everybody in this branch." />
                ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                      <th className="sticky start-0 z-10 bg-muted/40 px-4 py-2 text-left font-medium">Person</th>
                      {storeRoles.map((r) => (
                        <th key={r.id} className="px-3 py-2 text-center font-medium">
                          <span className="whitespace-nowrap">{r.name}</span>
                          {r.isSystem && (
                            <span className="ms-1 align-middle" title="Built-in administrator role">
                              <Icon name="lock" className="inline h-3 w-3" />
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="sticky start-0 z-10 bg-card px-4 py-2">
                          <div className="flex min-w-[10rem] flex-col">
                            <span className="flex items-center gap-1.5 font-medium">
                              {u.fullName}
                              {u.id === currentUserId && <Badge tone="brand">You</Badge>}
                              {!u.isActive && <Badge tone="neutral">Inactive</Badge>}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {u.username}
                              {u.departmentName ? ` · ${u.departmentName}` : ''}
                            </span>
                          </div>
                        </td>
                        {storeRoles.map((r) => {
                          const has = held.has(`${u.id}|${storeId}|${r.id}`);
                          const key = `${u.id}|${r.id}`;
                          const busy = busyCell === key;
                          return (
                            <td key={r.id} className="px-3 py-2 text-center">
                              <button
                                type="button"
                                disabled={!canEdit || pending}
                                onClick={() => toggle(u.id, r.id, has)}
                                aria-label={`${has ? 'Remove' : 'Give'} ${r.name} ${has ? 'from' : 'to'} ${u.fullName}`}
                                className={`grid h-6 w-6 place-items-center rounded border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  has
                                    ? 'border-success bg-success text-white hover:opacity-85'
                                    : 'border-border bg-card text-transparent hover:border-brand hover:text-brand/40'
                                }`}
                              >
                                <Icon name={busy ? 'clock' : 'check'} className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                ))}
              </ListFilter>
            </Card>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            A person can hold several roles in one branch; their permissions are everything those
            roles allow, added together. Two things are refused on purpose: removing your own last
            role, and removing the last administrator of a branch. Either would lock somebody out
            with no way back in.
          </p>
        </>
      )}
    </div>
  );
}
