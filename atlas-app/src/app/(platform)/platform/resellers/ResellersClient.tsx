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
import type { ResellerRow } from '@/server/platform-admin';
import { createResellerAction } from './actions';

interface Props {
  resellers: (Omit<ResellerRow, 'createdAt'> & { createdAt: string })[];
  canCreate: boolean;
  parentAccountId: string | null;
}

const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  GRACE_PERIOD: 'warning',
  READ_ONLY: 'warning',
  SUSPENDED: 'danger',
  TERMINATED: 'danger',
  ARCHIVED: 'neutral',
};

export function ResellersClient({ resellers, canCreate, parentAccountId }: Props) {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        badge="RS"
        title="Resellers"
        subtitle={`${resellers.length} reseller${resellers.length === 1 ? '' : 's'} in scope`}
        actions={canCreate && parentAccountId && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create reseller</Button>
        )}
      />

      {resellers.length === 0 ? (
        <Card>
          <EmptyState
            icon="building"
            title="No resellers yet"
            hint={canCreate ? 'Create the first one to start distributing Atlas.' : 'None exist under your scope yet.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ListFilter
            rows={resellers}
            // Date filter and sort, newest first (9 Oct 2026).
            dates={[{ key: 'created', label: 'Created on', of: (r) => r.createdAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
            noun="resellers"
            placeholder="Account code or name…"
            searchOn={(r) => [r.accountCode, r.name, r.lifecycleState]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every reseller." />
            ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Account code</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Lifecycle</th>
                <th className="px-4 py-2.5 font-medium">Tenants</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.accountCode}</td>
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/platform/resellers/${r.id}`} className="hover:underline">{r.name}</Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={LIFECYCLE_TONE[r.lifecycleState] ?? 'neutral'}>{r.lifecycleState}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.tenantCount}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
            ))}
          </ListFilter>
        </Card>
      )}

      {creating && parentAccountId && (
        <CreateResellerDialog parentAccountId={parentAccountId} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

function CreateResellerDialog({ parentAccountId, onClose }: { parentAccountId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSave = name.trim() && adminUsername.trim() && adminPassword.length >= 12;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await createResellerAction(parentAccountId, {
        name, adminFullName, adminUsername, adminEmail: adminEmail || null, adminPassword,
      });
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      open
      title="Create a reseller"
      subtitle="A license partner who can distribute Atlas to their own downstream customers"
      icon="building"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!canSave || pending} loading={pending} onClick={save}>
            Create reseller
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
          Reseller name
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </label>
        <div className="mt-1 border-t border-border pt-3">
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Owner login for this reseller
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
