'use client';

import { useState, useTransition } from 'react';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { saveMarkPolicyAction, setRolePrivilegeAction } from './actions';
import type { MarkPolicyInput } from '@/server/attendance-mark-policy';

/**
 * Two screens in one, because they answer the same question from two
 * angles: "who is allowed to touch somebody else's attendance record."
 * The rules below decide it per person; the grid decides which roles even
 * have the authority to try.
 */

interface RoleRow { id: string; name: string; isSystem: boolean }
interface PermOption { id: string; key: string; module: string; action: string }
interface UserOption { id: string; name: string; username: string }

const PERM_LABELS: Record<string, string> = {
  'attendance.view': 'View attendance',
  'attendance.locate': 'View location trail',
  'attendance.edit': 'Correct attendance',
};

export function PermissionsClient({
  markPolicy, roles, attendancePermissions, rolePermissionIds, users,
  canEditPolicy, canEditPrivilege, scopeIsAll,
}: {
  markPolicy: {
    restrictToRules: boolean; selfMarkingEnabled: boolean; managerMarksReports: boolean;
    roleIds: string[]; userIds: string[]; updatedAt: string | null;
  } | null;
  roles: RoleRow[];
  attendancePermissions: PermOption[];
  rolePermissionIds: Record<string, string[]>;
  users: UserOption[];
  canEditPolicy: boolean;
  canEditPrivilege: boolean;
  scopeIsAll: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grid, setGrid] = useState(rolePermissionIds);

  const [form, setForm] = useState<MarkPolicyInput>(markPolicy ?? {
    restrictToRules: false, selfMarkingEnabled: true, managerMarksReports: true, roleIds: [], userIds: [],
  });

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="MP" title="Attendance permissions" subtitle="Who may correct attendance for others, and which roles can" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="These rules differ between branches, so they are kept per branch." />
        </Card>
      </div>
    );
  }

  const save = () => {
    setError(null); setNotice(null);
    startTransition(async () => report(await saveMarkPolicyAction(form)));
  };

  const toggleRole = (id: string) => setForm((f) => ({
    ...f, roleIds: f.roleIds.includes(id) ? f.roleIds.filter((r) => r !== id) : [...f.roleIds, id],
  }));
  const toggleUser = (id: string) => setForm((f) => ({
    ...f, userIds: f.userIds.includes(id) ? f.userIds.filter((u) => u !== id) : [...f.userIds, id],
  }));

  const togglePrivilege = (roleId: string, key: string, currently: boolean) => {
    setGrid((g) => ({
      ...g,
      [roleId]: currently ? (g[roleId] ?? []).filter((k) => k !== key) : [...(g[roleId] ?? []), key],
    }));
    startTransition(async () => {
      const res = await setRolePrivilegeAction(roleId, key, !currently);
      if (res.error) {
        setError(res.error);
        // revert the optimistic flip
        setGrid((g) => ({
          ...g,
          [roleId]: currently ? [...(g[roleId] ?? []), key] : (g[roleId] ?? []).filter((k) => k !== key),
        }));
      } else {
        setNotice(null);
      }
    });
  };

  return (
    <div>
      <PageHeader badge="MP" title="Attendance permissions" subtitle="Who may correct attendance for others, and which roles can" />

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

      <SectionCard title="Who may correct attendance for others" icon="lock">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">Restrict to the rules below</span>
            <span className="block text-xs text-muted-foreground">
              Off by default - anyone holding &ldquo;Correct attendance&rdquo; may correct anyone&rsquo;s shift, as today.
            </span>
          </span>
          <input type="checkbox" disabled={!canEditPolicy} checked={form.restrictToRules}
            onChange={(e) => setForm((f) => ({ ...f, restrictToRules: e.target.checked }))}
            className="h-4 w-4 accent-brand" />
        </label>

        {form.restrictToRules && (
          <div className="mt-3 grid gap-3">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Self</span>
                <span className="block text-xs text-muted-foreground">Anyone may correct their own shift</span>
              </span>
              <input type="checkbox" disabled={!canEditPolicy} checked={form.selfMarkingEnabled}
                onChange={(e) => setForm((f) => ({ ...f, selfMarkingEnabled: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Manager of direct reports</span>
                <span className="block text-xs text-muted-foreground">Uses the reporting line set on the Hierarchy screen</span>
              </span>
              <input type="checkbox" disabled={!canEditPolicy} checked={form.managerMarksReports}
                onChange={(e) => setForm((f) => ({ ...f, managerMarksReports: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            <div>
              <p className="field-label">These roles may correct anyone</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {roles.map((r) => {
                  const on = form.roleIds.includes(r.id);
                  return (
                    <button key={r.id} type="button" disabled={!canEditPolicy} onClick={() => toggleRole(r.id)}
                      className={`h-8 rounded-lg border px-3 text-sm font-medium transition disabled:opacity-60 ${
                        on ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card text-muted-foreground hover:bg-muted'
                      }`}>
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="field-label">These people may correct anyone</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {users.map((u) => {
                  const on = form.userIds.includes(u.id);
                  return (
                    <button key={u.id} type="button" disabled={!canEditPolicy} onClick={() => toggleUser(u.id)}
                      className={`h-8 rounded-lg border px-3 text-sm font-medium transition disabled:opacity-60 ${
                        on ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card text-muted-foreground hover:bg-muted'
                      }`}>
                      {u.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {canEditPolicy && (
          <button type="button" disabled={pending} onClick={save}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60">
            <Icon name={pending ? 'clock' : 'check'} className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
            Save rules
          </button>
        )}
      </SectionCard>

      <div className="mt-4">
        <SectionCard title="Attendance privileges by role" icon="users" bodyClassName="p-0">
          {roles.length === 0 ? (
            <EmptyState icon="users" title="No roles yet" hint="Create a role on the Roles screen first." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Role</th>
                    {attendancePermissions.map((p) => (
                      <th key={p.id} className="px-3 py-2 text-center font-semibold">{PERM_LABELS[p.key] ?? p.key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.name}</span>
                        {r.isSystem && <Badge tone="neutral" className="ml-2">System</Badge>}
                      </td>
                      {attendancePermissions.map((p) => {
                        const has = r.isSystem ? true : (grid[r.id] ?? []).includes(p.key);
                        return (
                          <td key={p.id} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={has}
                              disabled={r.isSystem || !canEditPrivilege || pending}
                              onChange={() => togglePrivilege(r.id, p.key, has)}
                              className="h-4 w-4 accent-brand"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            System roles hold every permission automatically and cannot be edited here. Create a custom
            role on the Roles screen to grant a narrower set.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
