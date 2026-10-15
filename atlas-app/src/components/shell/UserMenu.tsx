'use client';

import { useState, useTransition } from 'react';
import { logout } from '@/app/login/actions';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { AnchoredPopover, usePopoverAnchor } from '@/components/ui/AnchoredPopover';
import type { LinkedAccountRow } from '@/server/linked-accounts';
import { linkAccountAction, unlinkAccountAction, switchAccountAction } from '@/app/actions/linked-accounts';
import { createBusinessAction } from '@/app/actions/provisioning';
import { DisplayPrefs } from './DisplayPrefs';

export function UserMenu({
  fullName, username, email, initials, roleNames = [], permissionCount = 0,
  linkedAccounts = [], canCreateBusiness = false, canLinkAccount = false,
}: {
  fullName: string;
  username: string;
  email: string | null;
  initials: string;
  roleNames?: string[];
  permissionCount?: number;
  /** The HR system, when this user administers attendance. Null hides it. */
  /** Other logins this person has proven they control - see linked-accounts.ts. */
  linkedAccounts?: LinkedAccountRow[];
  /**
   * `business.selfService` (§1.2 stop-gap) AND `Organization.allowSelfServiceBusinessCreation`/
   * `allowLinkedAccounts` (superadmin-roadmap Slice 8, D053) - two
   * independent gates, both must be true. A tenant Admin can still be
   * individually restricted even when the platform allows the tenant the
   * feature in general, and vice versa - the Platform Owner turns a
   * specific tenant off without touching anyone's role. Both default false
   * (hidden) rather than true, so a caller that forgets to pass them fails
   * closed, not open. Switching to or unlinking an account already linked
   * is NOT gated by either - only creating a new link/business is.
   */
  canCreateBusiness?: boolean;
  canLinkAccount?: boolean;
}) {
  const { ref, anchor, toggle, close, open } = usePopoverAnchor<HTMLButtonElement>();
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const switchTo = (linkedUserId: string) => {
    startTransition(async () => { await switchAccountAction(linkedUserId); });
  };
  const unlink = (linkedUserId: string) => {
    startTransition(async () => { await unlinkAccountAction(linkedUserId); window.location.reload(); });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full p-0.5 pe-1 transition hover:bg-muted"
      >
        <span className="relative grid h-8 w-8 place-items-center rounded-full bg-brand text-xs font-bold text-brand-fg">
          {initials}
          {/* Presence dot - the original shows one and users read it as "signed in". */}
          <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
        </span>
        <Icon name="chevron-down" className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {anchor && (
        <AnchoredPopover anchor={anchor} align="end" width={284} onClose={close}>
          <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {email ?? `@${username}`}
              </p>
            </div>
          </div>

          {roleNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
              {roleNames.map((r) => (
                <span
                  key={r}
                  className="rounded-full bg-navy/[0.08] px-2 py-0.5 text-xs font-medium text-on-tint-navy"
                >
                  {r}
                </span>
              ))}
              <span className="ms-auto text-xs text-muted-foreground">
                {permissionCount} permissions
              </span>
            </div>
          )}

          {(linkedAccounts.length > 0 || canLinkAccount || canCreateBusiness) && (
          <div className="border-b border-border py-1">
            <p className="px-3 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Switch business
            </p>
            {linkedAccounts.map((a) => (
              <div key={a.linkedUserId} className="group flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => switchTo(a.linkedUserId)}
                  className="flex flex-1 items-center gap-2.5 text-start disabled:opacity-50"
                >
                  <Icon name="building" className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.organizationName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.fullName} · @{a.username}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  title="Unlink"
                  onClick={() => unlink(a.linkedUserId)}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {canLinkAccount && (
              <button
                type="button"
                onClick={() => { close(); setLinkOpen(true); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-brand transition hover:bg-muted"
              >
                <Icon name="user-plus" className="h-4 w-4" />
                Link another account
              </button>
            )}
            {canCreateBusiness && (
              <button
                type="button"
                onClick={() => { close(); setCreateOpen(true); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-brand transition hover:bg-muted"
              >
                <Icon name="building" className="h-4 w-4" />
                Create a new business
              </button>
            )}
          </div>
          )}

          <DisplayPrefs />

          <a
            href="/set-password"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition hover:bg-muted"
          >
            <Icon name="lock" className="h-4 w-4 text-muted-foreground" />
            Change my password
          </a>

          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm text-danger transition hover:bg-danger/10"
            >
              <Icon name="log-out" className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </AnchoredPopover>
      )}

      {linkOpen && <LinkAccountDialog onClose={() => setLinkOpen(false)} />}
      {createOpen && <CreateBusinessDialog onClose={() => setCreateOpen(false)} />}
    </>
  );
}

function LinkAccountDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await linkAccountAction(username, password);
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title="Link another account"
      subtitle="A second business you run on Atlas, with its own separate login"
      icon="user-plus"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!username.trim() || !password || pending} loading={pending} onClick={save}>
            Link account
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
          Type that business&apos;s own username and password, just this once. Atlas will remember it&apos;s
          you, so next time you can switch to it with one click, no password needed. The two businesses
          stay completely separate; this only makes switching between them faster.
        </p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Username
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}

const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

function CreateBusinessDialog({ onClose }: { onClose: () => void }) {
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
    startTransition(async () => {
      const res = await createBusinessAction({
        orgName, storeName, branchCode, adminFullName,
        adminUsername, adminEmail: adminEmail || null, adminPassword,
      });
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title="Create a new business"
      subtitle="A wholly separate organisation, with its own store, admin login and data - linked here so you can switch to it"
      icon="building"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!canSave || pending} loading={pending} onClick={save}>
            Create business
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
          This creates a brand-new business - its own organisation, first branch, and admin login.
          Nothing about it is shared with the business you are in now except this link, which lets
          you switch between them without signing in again.
        </p>
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
            Admin login for this business
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
