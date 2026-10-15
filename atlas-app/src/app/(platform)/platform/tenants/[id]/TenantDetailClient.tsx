'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Badge, EmptyState, PageHeader, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { PLANS, PLATFORM_FEATURES, SELLABLE_MODULES, planById, resolveEntitlement } from '@/lib/plans';
import { Button, ToggleChip } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import type { TenantDetail, TenantUserRow, AuditEventRow, HideablePage } from '@/server/platform-admin';
import { setTenantPlanAction } from './actions';
import {
  suspendTenantAction, reactivateTenantAction, scheduleLockAction, cancelScheduledLockAction,
} from '../actions';
import { AccessTenantDialog, LIFECYCLE_TONE } from '../TenantsClient';
import {
  resetTenantAdminPasswordAction, changeTenantAdminUsernameAction, forceLogoutUserAction, setTenantFlagsAction,
  setTenantShopSlugAction,
} from './actions';

type TenantVM = Omit<TenantDetail, 'createdAt' | 'scheduledLockAt' | 'trialEndsAt' | 'businessesCreated'> & {
  trialEndsAt: string | null;
  createdAt: string;
  scheduledLockAt: string | null;
  businessesCreated: (Omit<TenantDetail['businessesCreated'][number], 'createdAt'> & { createdAt: string })[];
};
type UserVM = Omit<TenantUserRow, 'lastLoginAt'> & { lastLoginAt: string | null };
type AuditVM = Omit<AuditEventRow, 'startedAt'> & { startedAt: string };

const LOCKED_STATES = new Set(['SUSPENDED', 'TERMINATED']);
const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

interface Props {
  tenant: TenantVM;
  users: UserVM[];
  auditEvents: AuditVM[];
  canManageLifecycle: boolean;
  canAccessTenant: boolean;
  canManageCredentials: boolean;
  canManageFlags: boolean;
  canViewAudit: boolean;
  /** Pages this owner may switch off for the client, read from the real menu (F-01). */
  pages: HideablePage[];
}

export function TenantDetailClient({
  tenant, users, auditEvents, canManageLifecycle, canAccessTenant, canManageCredentials, canManageFlags, canViewAudit,
  pages,
}: Props) {
  const [accessing, setAccessing] = useState(false);
  const [credentialTarget, setCredentialTarget] = useState<{ user: UserVM; action: 'reset' | 'username' | 'logout' } | null>(null);

  return (
    <div className="grid gap-4">
      <div>
        <Link href="/platform/tenants" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Icon name="arrow-left" className="h-3.5 w-3.5" /> Back to tenants
        </Link>
        <PageHeader
          badge="building"
          title={tenant.name}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-xs">{tenant.orgCode}</span>
              <Badge tone={LIFECYCLE_TONE[tenant.lifecycleState] ?? 'neutral'}>{tenant.lifecycleState}</Badge>
            </span>
          }
          actions={canAccessTenant && (
            <Button variant="primary" icon="eye" onClick={() => setAccessing(true)}>Access Tenant</Button>
          )}
        />
      </div>

      {canManageLifecycle && <LifecycleSection tenant={tenant} />}
      {canManageFlags && <PlanSection tenant={tenant} pages={pages} />}
      {canManageFlags && <FlagsSection tenant={tenant} />}
      {canManageFlags && <ShopAddressSection tenant={tenant} />}

      <SectionCard title="Branches" icon="grid">
        {tenant.stores.length === 0 ? (
          <EmptyState icon="grid" title="No branches" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tenant.stores.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.branchCode}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {canManageCredentials && (
        <SectionCard title="Users" icon="users">
          {users.length === 0 ? (
            <EmptyState icon="users" title="No users in this tenant" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Username</th>
                    <th className="px-3 py-2 font-medium">Roles</th>
                    <th className="px-3 py-2 font-medium">Last login</th>
                    <th className="px-3 py-2 font-medium">Sessions</th>
                    <th className="px-3 py-2 font-medium">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{u.fullName}{!u.isActive && <Badge tone="neutral" className="ms-2">Inactive</Badge>}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">@{u.username}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.roleNames.join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{u.activeSessions}</td>
                      <td className="px-3 py-2 text-end">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" icon="lock" title="Reset password" onClick={() => setCredentialTarget({ user: u, action: 'reset' })}>Reset</Button>
                          <Button size="sm" icon="pencil" title="Change username" onClick={() => setCredentialTarget({ user: u, action: 'username' })}>Username</Button>
                          <Button size="sm" icon="log-out" title="Force logout" onClick={() => setCredentialTarget({ user: u, action: 'logout' })}>Logout</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {canViewAudit && (
        <SectionCard title="Recent activity" icon="clock">
          {auditEvents.length === 0 ? (
            <EmptyState icon="clock" title="No privileged activity recorded yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">By</th>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(e.startedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2"><Badge tone="navy">{e.actionType}</Badge></td>
                      <td className="px-3 py-2">{e.actingUserName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.targetUserName ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {accessing && (
        <AccessTenantDialog organizationId={tenant.id} organizationName={tenant.name} onClose={() => setAccessing(false)} />
      )}
      {credentialTarget && (
        <CredentialDialog
          organizationId={tenant.id}
          target={credentialTarget.user}
          action={credentialTarget.action}
          onClose={() => setCredentialTarget(null)}
        />
      )}
    </div>
  );
}

function LifecycleSection({ tenant }: { tenant: TenantVM }) {
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
    <SectionCard title="Status" icon="lock">
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </p>
        )}

        <SummaryRow label="Current status" value={<Badge tone={LIFECYCLE_TONE[tenant.lifecycleState] ?? 'neutral'}>{tenant.lifecycleState}</Badge>} />

        {tenant.scheduledLockAt && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-sm">
            <p className="text-warning">
              Lock scheduled for {new Date(tenant.scheduledLockAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
              {tenant.lockReason && ` - "${tenant.lockReason}"`}
            </p>
            <Button className="mt-2" icon="x" disabled={pending || !password} onClick={() => run(() => cancelScheduledLockAction(tenant.id, password))}>
              Cancel scheduled lock
            </Button>
          </div>
        )}

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason (required for every action below)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Your password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          <span className="text-xs text-muted-foreground">Skipped if you re-entered it in the last 15 minutes.</span>
        </label>

        <div className="flex flex-wrap gap-2">
          {isLocked ? (
            <Button variant="primary" icon="check" disabled={!reason.trim() || !password || pending} loading={pending}
              onClick={() => run(() => reactivateTenantAction(tenant.id, reason, password))}>
              Reactivate
            </Button>
          ) : (
            <>
              <Button icon="lock" disabled={!reason.trim() || !password || pending} loading={pending}
                className="border-danger/40 text-danger hover:bg-danger/5"
                onClick={() => run(() => suspendTenantAction(tenant.id, reason, password))}>
                Suspend now
              </Button>
              <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className={fieldClass} />
              <Button icon="calendar" disabled={!lockDate || !reason.trim() || !password || pending} loading={pending}
                onClick={() => run(() => scheduleLockAction(tenant.id, new Date(lockDate).toISOString(), reason, password))}>
                Schedule lock
              </Button>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * The business's shop address (3 Oct 2026). On the shared server every
 * business needs its own, or its customers cannot reach its shop at all.
 */
function ShopAddressSection({ tenant }: { tenant: TenantVM }) {
  const [slug, setSlug] = useState(tenant.shopSlug ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = () => {
    setError(null); setSaved(null);
    startTransition(async () => {
      const res = await setTenantShopSlugAction(tenant.id, slug);
      if (res.error) setError(res.error); else setSaved(slug.trim() ? 'Saved. The shop is live at this address.' : 'Cleared. The public shop is offline; portal customers still see it.');
    });
  };
  return (
    <SectionCard title="Shop address" icon="globe">
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Where this business&rsquo;s customers find its shop. A short name of letters, digits and hyphens.
          Leave blank for no public shop - customers who sign in still see it in their portal.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">atlas.nairsolutions.org/shop/</span>
          <input
            id="shop-slug" value={slug} placeholder="vcare"
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className={`${fieldClass} w-48`}
          />
          <Button variant="primary" icon="check" loading={pending} onClick={save}>Save</Button>
          {tenant.shopSlug && (
            <a href={`/shop/${tenant.shopSlug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand hover:underline">Open the shop</a>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        {saved && !pending && <p className="text-xs text-success">{saved}</p>}
      </div>
    </SectionCard>
  );
}

function FlagsSection({ tenant }: { tenant: TenantVM }) {
  const [createBiz, setCreateBiz] = useState(tenant.allowSelfServiceBusinessCreation);
  const [linkAccounts, setLinkAccounts] = useState(tenant.allowLinkedAccounts);
  const [businessLimit, setBusinessLimit] = useState(tenant.businessLimit === null ? '' : String(tenant.businessLimit));
  const [branchLimit, setBranchLimit] = useState(tenant.branchLimit === null ? '' : String(tenant.branchLimit));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = (next: Partial<{ createBiz: boolean; linkAccounts: boolean }> = {}) => {
    setError(null); setSaved(false);
    startTransition(async () => {
      const res = await setTenantFlagsAction(tenant.id, {
        allowSelfServiceBusinessCreation: next.createBiz ?? createBiz,
        allowLinkedAccounts: next.linkAccounts ?? linkAccounts,
        businessLimit: num(businessLimit),
        branchLimit: num(branchLimit),
      });
      if (res.error) setError(res.error); else setSaved(true);
    });
  };
  const used = tenant.businessesCreated.length;

  return (
    <SectionCard title="Plan controls" icon="sliders">
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Adding businesses and branches is part of the paid plan. Only this tenant&apos;s built-in Admin can add a
          business, and only while it is switched on here. Linked accounts let anyone switch between their own logins.
        </p>
        <div className="flex flex-wrap gap-2">
          <ToggleChip
            on={createBiz} label="Can add new businesses" offLabel="Adding businesses off"
            onChange={(next) => { setCreateBiz(next); save({ createBiz: next }); }}
          />
          <ToggleChip
            on={linkAccounts} label="Linked accounts" offLabel="Linked accounts off"
            onChange={(next) => { setLinkAccounts(next); save({ linkAccounts: next }); }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <label htmlFor="plan-biz" className="text-xs font-medium text-muted-foreground">Extra businesses allowed</label>
            <input id="plan-biz" inputMode="numeric" placeholder="No limit" value={businessLimit}
              onChange={(e) => setBusinessLimit(e.target.value.replace(/[^0-9]/g, ''))} className={fieldClass} />
            <span className="text-xs text-muted-foreground">{used} created so far</span>
          </div>
          <div className="grid gap-1">
            <label htmlFor="plan-branch" className="text-xs font-medium text-muted-foreground">Branches allowed</label>
            <input id="plan-branch" inputMode="numeric" placeholder="No limit" value={branchLimit}
              onChange={(e) => setBranchLimit(e.target.value.replace(/[^0-9]/g, ''))} className={fieldClass} />
            <span className="text-xs text-muted-foreground">{tenant.stores.length} in use</span>
          </div>
          <div className="flex items-end">
            <Button variant="primary" icon="check" loading={pending} onClick={() => save()}>Save limits</Button>
          </div>
        </div>
        {saved && !pending && <p className="text-xs text-success">Saved.</p>}
        {tenant.createdFrom && (
          <p className="text-xs text-muted-foreground">
            This business was created from{' '}
            <Link href={`/platform/tenants/${tenant.createdFrom.id}`} className="text-brand hover:underline">{tenant.createdFrom.name}</Link>.
          </p>
        )}
        {used > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Businesses this tenant created</p>
            <ul className="grid gap-1 text-sm">
              {tenant.businessesCreated.map((b) => (
                <li key={b.id} className="flex flex-wrap gap-x-2">
                  <Link href={`/platform/tenants/${b.id}`} className="font-medium text-brand hover:underline">{b.name}</Link>
                  <span className="font-mono text-xs text-muted-foreground">{b.orgCode}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(b.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                    {b.createdByName ? ` · by ${b.createdByName}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function CredentialDialog({
  organizationId, target, action, onClose,
}: {
  organizationId: string;
  target: UserVM;
  action: 'reset' | 'username' | 'logout';
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState(target.username);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const meta = {
    reset: { title: 'Reset password', icon: 'lock' as const, tone: 'danger' as const },
    username: { title: 'Change username', icon: 'pencil' as const, tone: 'danger' as const },
    logout: { title: 'Force logout', icon: 'log-out' as const, tone: 'brand' as const },
  }[action];

  const canSave =
    reason.trim() && password
    && (action !== 'reset' || newPassword.length >= 12)
    && (action !== 'username' || (newUsername.trim() && newUsername.trim().toLowerCase() !== target.username));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = action === 'reset'
        ? await resetTenantAdminPasswordAction(organizationId, target.id, newPassword, password, reason)
        : action === 'username'
          ? await changeTenantAdminUsernameAction(organizationId, target.id, newUsername, password, reason)
          : await forceLogoutUserAction(organizationId, target.id, password, reason);
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title={meta.title}
      subtitle={`${target.fullName} (@${target.username})`}
      icon={meta.icon}
      tone={meta.tone}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={meta.tone === 'danger' ? 'danger' : 'primary'} icon="check" disabled={!canSave || pending} loading={pending} onClick={save}>
            {meta.title}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {action === 'reset' && 'Sets a new password and signs this user out everywhere. They will need the new password to sign in again.'}
          {action === 'username' && "Changes this user's login username. They will need to use the new username to sign in."}
          {action === 'logout' && 'Signs this user out of every device immediately, no password change.'}
          {' '}This is logged with your name and the reason below.
        </p>

        {action === 'reset' && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            New password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={fieldClass} />
            <span className="text-xs text-muted-foreground">At least 12 characters.</span>
          </label>
        )}
        {action === 'username' && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            New username
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className={fieldClass} />
          </label>
        )}

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Your password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          <span className="text-xs text-muted-foreground">Skipped if you re-entered it in the last 15 minutes.</span>
        </label>
      </div>
    </Modal>
  );
}

/**
 * What this client is entitled to (workstream F, 1 Oct 2026).
 *
 * The platform owner's layer. Everything else in Atlas lets a CLIENT
 * configure their own product; this decides what they may have at all, and it
 * wins - server/context.ts applies it after their own menu settings, so a
 * client cannot switch on a module their plan excludes.
 */
function PlanSection({ tenant, pages }: { tenant: TenantVM; pages: HideablePage[] }) {
  const [planId, setPlanId] = useState(tenant.planId);
  const [userLimit, setUserLimit] = useState(tenant.userLimit === null ? '' : String(tenant.userLimit));
  const [trialEndsAt, setTrialEndsAt] = useState(tenant.trialEndsAt ? tenant.trialEndsAt.slice(0, 10) : '');
  const [custom, setCustom] = useState<string[] | null>(tenant.excludedModules);
  const [features, setFeatures] = useState<string[]>(tenant.enabledFeatures);
  const [hiddenPages, setHiddenPages] = useState<string[]>(tenant.excludedPages);
  const [showPages, setShowPages] = useState(tenant.excludedPages.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const plan = planById(planId);
  // What they would actually get, worked out by the same function the server
  // uses - so this panel cannot promise something the product will not do.
  const effective = resolveEntitlement({
    planId,
    userLimitOverride: userLimit.trim() === '' ? null : Number(userLimit),
    excludedModulesOverride: custom,
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    enabledFeatures: features,
    excludedPages: hiddenPages,
  });

  const excluded = new Set(effective.excludedModules);

  const toggle = (m: string) => {
    const next = new Set(custom ?? plan.excludedModules);
    if (next.has(m)) next.delete(m); else next.add(m);
    setCustom([...next]);
  };

  const save = () => {
    setError(null); setSaved(false);
    startTransition(async () => {
      const res = await setTenantPlanAction(tenant.id, {
        planId,
        userLimit: userLimit.trim() === '' ? null : Number(userLimit),
        excludedModules: custom,
        excludedPages: hiddenPages,
        trialEndsAt: trialEndsAt || null,
        enabledFeatures: features,
      });
      if (res.error) setError(res.error); else setSaved(true);
    });
  };

  return (
    <SectionCard title="Plan & entitlement" icon="lock">
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </p>
        )}
        {saved && <p className="text-sm text-success">Saved.</p>}

        <p className="text-xs text-muted-foreground">
          This decides what the client may have at all. It is applied after their own menu
          settings, so they cannot switch a module back on themselves.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Plan</span>
            <select
              value={planId}
              onChange={(e) => { setPlanId(e.target.value); setCustom(null); }}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">{plan.hint}</span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">User limit (blank = plan default)</span>
            <input
              type="number" min="1" value={userLimit}
              onChange={(e) => setUserLimit(e.target.value)}
              placeholder={plan.userLimit === null ? 'No limit' : String(plan.userLimit)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
            {/* The cap against reality, so nobody sets a limit below the
                number of people already signed up. */}
            <span className="mt-1 block text-xs text-muted-foreground">
              {tenant.activeUsers} active now
              {effective.userLimit !== null && tenant.activeUsers > effective.userLimit
                ? ' — already over this limit; existing people keep working, no new ones can be added'
                : ''}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Trial ends (blank = not a trial)</span>
            <input
              type="date" value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
            {effective.trialExpired && (
              <span className="mt-1 block text-xs text-warning">This trial has already ended.</span>
            )}
          </label>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">
            Modules {custom === null && <span className="font-normal text-muted-foreground">(from the plan)</span>}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SELLABLE_MODULES.map((m) => (
              <button
                key={m} type="button" onClick={() => toggle(m)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  excluded.has(m)
                    ? 'border-border bg-muted text-muted-foreground line-through'
                    : 'border-brand/40 bg-brand/10 text-on-tint-brand'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Struck through means this client does not get it. Dashboard, My Desk, Users &amp; Roles
            and System Settings are always included &mdash; an Atlas without them cannot be
            administered.
          </p>
          {custom !== null && (
            <Button variant="ghost" onClick={() => setCustom(null)}>Back to the plan&rsquo;s own modules</Button>
          )}
        </fieldset>

        {/*
          ONE PAGE AT A TIME (F-01, 10 Oct 2026).

          The chips above sell sidebar groups, which `lib/plans` argued for
          years was the only grain this console should have: whether a client
          gets HRM is ours, which screen inside it they see is theirs. Pravin
          overruled it - "hum har cheez ko hide kar sake as a platform owner" -
          because the cases are real and a module per case is worse: HRM
          without Payroll, Services without manufacturing, a client who never
          bought the cost trail.

          Read from the client's own MENU, not a list of routes kept here, so
          the owner reads "Payroll > Travel Allowance" and the list cannot
          drift from what the client actually sees. Collapsed unless something
          is already hidden, because for most clients the answer is nothing.

          The ways IN and the ways to ADMINISTER are not in this list at all
          (lib/plans NEVER_HIDEABLE): hiding Settings > Users would leave a
          business that can never add a person again, and the only one who
          could undo it is whoever is reading this.
        */}
        <fieldset>
          <button
            type="button"
            onClick={() => setShowPages(!showPages)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              Individual pages
              {hiddenPages.length > 0 && <Badge tone="warning">{hiddenPages.length} switched off</Badge>}
            </span>
            <Icon name={showPages ? 'chevron-up' : 'chevron-down'} className="h-4 w-4" />
          </button>
          {showPages && (
            <div className="mt-2 grid gap-3">
              <p className="text-xs text-muted-foreground">
                Finer than the modules above - for a client who gets HRM but not Payroll. A page
                switched off here redirects to &ldquo;Not part of your plan&rdquo; for everybody in
                that business, disappears from their menu, their search and their handbook, and
                cannot be granted by any role. Their data is kept: putting the page back brings
                everything back.
              </p>
              {[...new Set(pages.map((x) => x.group))].map((group) => {
                const rows = pages.filter((x) => x.group === group);
                const groupOff = rows.length > 0 && rows.every((r) => !!r.module && excluded.has(r.module));
                return (
                  <div key={group}>
                    <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                      {groupOff && <Badge tone="neutral">whole module already off</Badge>}
                    </p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {rows.map((row) => {
                        const off = hiddenPages.includes(row.route);
                        const moot = !!row.module && excluded.has(row.module);
                        return (
                          <label
                            key={row.route}
                            className={`flex items-start gap-2 text-sm ${moot ? 'opacity-50' : ''}`}
                            title={moot ? `${row.module} is switched off, so this page is already gone.` : row.route}
                          >
                            <input
                              type="checkbox" className="mt-0.5"
                              checked={off}
                              onChange={(e) => setHiddenPages(
                                e.currentTarget.checked
                                  ? [...new Set([...hiddenPages, row.route])]
                                  : hiddenPages.filter((r) => r !== row.route),
                              )}
                            />
                            <span>
                              {row.label}
                              <span className="block font-mono text-micro text-muted-foreground">{row.route}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {pages.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No menu rows found to offer. Run the tenant defaults sync and reload.
                </p>
              )}
            </div>
          )}
        </fieldset>

        {/*
          FEATURES, not modules.

          A separate fieldset because the question is different: a module is
          "do they get this part of Atlas", a feature is "does this capability
          appear inside the parts they already have". Mixing them into one row
          of chips would read as one list with two meanings, and switching off
          "Inventory" and switching off "Expiry dates" are not the same size of
          decision.

          Off by default for everyone - a feature that appears for every client
          would not need to be here.
        */}
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Extra features</legend>
          <div className="grid gap-1.5">
            {PLATFORM_FEATURES.map((f) => (
              <label key={f.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox" className="mt-0.5"
                  checked={features.includes(f.id)}
                  onChange={(e) => setFeatures(
                    e.currentTarget.checked
                      ? [...new Set([...features, f.id])]
                      : features.filter((x) => x !== f.id),
                  )}
                />
                <span>
                  {f.label}
                  <span className="block text-xs text-muted-foreground">{f.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <Button icon="check" loading={pending} onClick={save}>Save plan</Button>
        </div>
      </div>
    </SectionCard>
  );
}
