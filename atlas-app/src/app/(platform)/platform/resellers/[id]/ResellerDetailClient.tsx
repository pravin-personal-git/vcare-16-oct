'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Badge, EmptyState, PageHeader, SectionCard, SummaryRow } from '@/components/ui/Layout';
import type { BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { ResellerDetail } from '@/server/platform-admin';
import { suspendResellerAction, reactivateResellerAction } from '../actions';

type ResellerVM = Omit<ResellerDetail, 'createdAt' | 'scheduledLockAt'> & {
  createdAt: string;
  scheduledLockAt: string | null;
};

const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  GRACE_PERIOD: 'warning',
  READ_ONLY: 'warning',
  SUSPENDED: 'danger',
  TERMINATED: 'danger',
  ARCHIVED: 'neutral',
};

const LOCKED_STATES = new Set(['SUSPENDED', 'TERMINATED']);
const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

export function ResellerDetailClient({ reseller, canManageLifecycle }: { reseller: ResellerVM; canManageLifecycle: boolean }) {
  return (
    <div className="grid gap-4">
      <div>
        <Link href="/platform/resellers" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Icon name="arrow-left" className="h-3.5 w-3.5" /> Back to resellers
        </Link>
        <PageHeader
          badge="building"
          title={reseller.name}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-xs">{reseller.accountCode}</span>
              <Badge tone={LIFECYCLE_TONE[reseller.lifecycleState] ?? 'neutral'}>{reseller.lifecycleState}</Badge>
            </span>
          }
        />
      </div>

      {canManageLifecycle && <LifecycleSection reseller={reseller} />}

      <SectionCard title="Tenants in this subtree" icon="building">
        {reseller.tenants.length === 0 ? (
          <EmptyState icon="building" title="No tenants yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Org code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {reseller.tenants.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.orgCode}</td>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/platform/tenants/${t.id}`} className="hover:underline">{t.name}</Link>
                    </td>
                    <td className="px-3 py-2"><Badge tone={LIFECYCLE_TONE[t.lifecycleState] ?? 'neutral'}>{t.lifecycleState}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function LifecycleSection({ reseller }: { reseller: ResellerVM }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isLocked = LOCKED_STATES.has(reseller.lifecycleState);

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
        <SummaryRow label="Current status" value={<Badge tone={LIFECYCLE_TONE[reseller.lifecycleState] ?? 'neutral'}>{reseller.lifecycleState}</Badge>} />
        <p className="text-xs text-muted-foreground">
          Suspending a reseller does not itself suspend their tenants - each tenant keeps its own
          lifecycle state, manageable from its own detail page.
        </p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Your password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          <span className="text-xs text-muted-foreground">Skipped if you re-entered it in the last 15 minutes.</span>
        </label>
        {isLocked ? (
          <Button variant="primary" icon="check" disabled={!reason.trim() || !password || pending} loading={pending}
            onClick={() => run(() => reactivateResellerAction(reseller.id, reason, password))}>
            Reactivate
          </Button>
        ) : (
          <Button icon="lock" disabled={!reason.trim() || !password || pending} loading={pending}
            className="border-danger/40 text-danger hover:bg-danger/5"
            onClick={() => run(() => suspendResellerAction(reseller.id, reason, password))}>
            Suspend now
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
