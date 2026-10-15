'use client';
import { newestFirst, oldestFirst } from '@/lib/card-list';
import { ListFilter } from '@/components/ui/ListFilter';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import type { BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import type { TenantRow } from '@/server/platform-admin';
import type { CreateTenantInput } from '@/server/platform-admin';
import {
  createTenantAction, suspendTenantAction, reactivateTenantAction,
  scheduleLockAction, cancelScheduledLockAction,
} from './actions';
import { startTenantAccessAction } from '@/app/actions/impersonation';

type TenantVM = Omit<TenantRow, 'createdAt' | 'scheduledLockAt'> & {
  createdAt: string;
  scheduledLockAt: string | null;
};

interface Props {
  tenants: TenantVM[];
  canCreate: boolean;
  platformAccountId: string | null;
  /** `platformTenant.access` (superadmin-roadmap Slice 5) - gates the "Access Tenant" button per row. */
  canAccessTenant: boolean;
  /** `platformTenant.suspend` (Slice 6) - gates the "Manage" (lifecycle) button per row. */
  canManageLifecycle: boolean;
}

export const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  GRACE_PERIOD: 'warning',
  READ_ONLY: 'warning',
  SUSPENDED: 'danger',
  TERMINATED: 'danger',
  ARCHIVED: 'neutral',
};

export function TenantsClient({
  tenants, canCreate, platformAccountId, canAccessTenant, canManageLifecycle,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [accessing, setAccessing] = useState<{ id: string; name: string } | null>(null);
  const [managing, setManaging] = useState<TenantVM | null>(null);

  return (
    <div>
      <PageHeader
        badge="PT"
        title="Tenants"
        subtitle={`${tenants.length} tenant${tenants.length === 1 ? '' : 's'} in scope`}
        actions={canCreate && platformAccountId && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create tenant</Button>
        )}
      />

      {tenants.length === 0 ? (
        <Card>
          <EmptyState
            icon="building"
            title="No tenants yet"
            hint={canCreate ? 'Create the first one to get started.' : 'None have been created under your scope yet.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* F1b / D17. The fleet console is the one list that grows with the
              business - D8 plans for 20+ clients in six months - so it needs
              search and a lifecycle filter before it needs anything else. */}
          <ListFilter
            rows={tenants}
            // Date filter and sort, newest first (9 Oct 2026).
            dates={[{ key: 'created', label: 'Created on', of: (r) => r.createdAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
            noun="businesses"
            placeholder="Org code or name…"
            searchOn={(t) => [t.orgCode, t.name, t.lifecycleState]}
            chipOf={(t) => t.lifecycleState}
            chipLabel="Lifecycle"
            chips={[...new Set(tenants.map((t) => t.lifecycleState))].sort().map((s) => ({
              value: s, label: s, count: tenants.filter((t) => t.lifecycleState === s).length,
            }))}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every business." />
            ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Org code</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Lifecycle</th>
                <th className="px-4 py-2.5 font-medium">Branches</th>
                <th className="px-4 py-2.5 font-medium">Can add businesses</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                {(canAccessTenant || canManageLifecycle) && <th className="px-4 py-2.5 font-medium">&nbsp;</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.orgCode}</td>
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/platform/tenants/${t.id}`} className="hover:underline">{t.name}</Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={LIFECYCLE_TONE[t.lifecycleState] ?? 'neutral'}>{t.lifecycleState}</Badge>
                    {t.scheduledLockAt && (
                      <div className="mt-1 text-xs text-warning">
                        Lock scheduled {new Date(t.scheduledLockAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {t.storeCount}{t.branchLimit !== null ? ` / ${t.branchLimit}` : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.canCreateBusiness
                      ? <Badge tone="success">{`Yes · ${t.businessesCreated} used${t.businessLimit !== null ? ` of ${t.businessLimit}` : ''}`}</Badge>
                      : <span className="text-muted-foreground">No{t.businessesCreated ? ` (${t.businessesCreated} made earlier)` : ''}</span>}
                    {t.createdFromName && <div className="mt-1 text-xs text-muted-foreground">Created from {t.createdFromName}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  {(canAccessTenant || canManageLifecycle) && (
                    <td className="px-4 py-2.5 text-end">
                      <div className="flex justify-end gap-2">
                        {canManageLifecycle && (
                          <Button icon="lock" onClick={() => setManaging(t)}>Manage</Button>
                        )}
                        {canAccessTenant && (
                          <Button icon="eye" onClick={() => setAccessing({ id: t.id, name: t.name })}>
                            Access Tenant
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
            ))}
          </ListFilter>
        </Card>
      )}

      {creating && platformAccountId && (
        <CreateTenantDialog platformAccountId={platformAccountId} onClose={() => setCreating(false)} />
      )}
      {accessing && (
        <AccessTenantDialog organizationId={accessing.id} organizationName={accessing.name} onClose={() => setAccessing(null)} />
      )}
      {managing && (
        <LifecycleDialog tenant={managing} onClose={() => setManaging(null)} />
      )}
    </div>
  );
}

const LOCKED_STATES = new Set(['SUSPENDED', 'TERMINATED']);

function LifecycleDialog({ tenant, onClose }: { tenant: TenantVM; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [lockDate, setLockDate] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isLocked = LOCKED_STATES.has(tenant.lifecycleState);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title="Manage tenant status"
      subtitle={tenant.name}
      icon="lock"
      size="sm"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="grid gap-4">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Current status:</span>
          <Badge tone={LIFECYCLE_TONE[tenant.lifecycleState] ?? 'neutral'}>{tenant.lifecycleState}</Badge>
        </div>

        {tenant.scheduledLockAt && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-sm">
            <p className="text-warning">
              Lock scheduled for{' '}
              {new Date(tenant.scheduledLockAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
              {tenant.lockReason && ` - "${tenant.lockReason}"`}
            </p>
            <Button
              className="mt-2" icon="x" disabled={pending || !password}
              onClick={() => run(() => cancelScheduledLockAction(tenant.id, password))}
            >
              Cancel scheduled lock
            </Button>
          </div>
        )}

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason (required for every action below)
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Your password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          <span className="text-xs text-muted-foreground">Skipped if you re-entered it in the last 15 minutes.</span>
        </label>

        {isLocked ? (
          <Button
            variant="primary" icon="check" disabled={!reason.trim() || !password || pending} loading={pending}
            onClick={() => run(() => reactivateTenantAction(tenant.id, reason, password))}
          >
            Reactivate
          </Button>
        ) : (
          <Button
            icon="lock" disabled={!reason.trim() || !password || pending} loading={pending}
            className="border-danger/40 text-danger hover:bg-danger/5"
            onClick={() => run(() => suspendTenantAction(tenant.id, reason, password))}
          >
            Suspend now
          </Button>
        )}

        {!isLocked && (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Or schedule a lock for later
            </p>
            <div className="flex gap-2">
              <input
                type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <Button
                icon="calendar" disabled={!lockDate || !reason.trim() || !password || pending} loading={pending}
                onClick={() => run(() => scheduleLockAction(tenant.id, new Date(lockDate).toISOString(), reason, password))}
              >
                Schedule
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function AccessTenantDialog({
  organizationId, organizationName, onClose,
}: { organizationId: string; organizationName: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await startTenantAccessAction(organizationId, password, reason);
      // A successful call redirects server-side and never returns here -
      // reaching this line at all means it didn't.
      if (res?.error) setError(res.error);
    });
  };

  return (
    <Modal
      open
      title="Access Tenant"
      subtitle={`Enter as ${organizationName} - every action while inside is logged`}
      icon="eye"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="eye"
            disabled={!password || !reason.trim() || pending} loading={pending}
            onClick={save}
          >
            Access Tenant
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
        <p className="text-xs text-muted-foreground">
          You will see and act on this tenant&apos;s data exactly as their own Admin does. An audit
          record is written with your name, the reason below, and when you return to the platform.
        </p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Your password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Support ticket #1234 - investigating a stuck invoice"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}

const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

function CreateTenantDialog({ platformAccountId, onClose }: { platformAccountId: string; onClose: () => void }) {
  const [orgName, setOrgName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSave = orgName.trim() && storeName.trim() && branchCode.trim()
    && adminUsername.trim() && adminPassword.length >= 12;

  const save = () => {
    setError(null);
    const input: CreateTenantInput = {
      orgName, storeName, branchCode, adminFullName,
      adminUsername, adminEmail: adminEmail || null, adminPassword,
    };
    startTransition(async () => {
      const res = await createTenantAction(platformAccountId, input);
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title="Create a tenant"
      subtitle="A wholly new Atlas customer - its own organisation, first branch, and admin login"
      icon="building"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!canSave || pending} loading={pending} onClick={save}>
            Create tenant
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
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Business name
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className={fieldClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            First branch name
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Branch code
            <input value={branchCode} maxLength={10}
              onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
              className={`${fieldClass} font-mono uppercase`} placeholder="BR001" />
          </label>
        </div>
        <div className="mt-1 border-t border-border pt-3">
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Admin login for this tenant
          </p>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Admin full name
          <input value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} className={fieldClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Username
            <input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Email (optional)
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={fieldClass} />
          </label>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Password
          <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
            className={fieldClass} />
          <span className="text-xs text-muted-foreground">At least 12 characters.</span>
        </label>
      </div>
    </Modal>
  );
}
