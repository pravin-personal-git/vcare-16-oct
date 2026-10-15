'use client';

import { useState, useTransition } from 'react';
import { PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { updateMaxResellerDepthAction } from './actions';

const fieldClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

export function SettingsClient({ maxResellerDepth, canEdit }: { maxResellerDepth: number; canEdit: boolean }) {
  const [depth, setDepth] = useState(String(maxResellerDepth));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setSaved(false);
    const n = Number(depth);
    startTransition(async () => {
      const res = await updateMaxResellerDepthAction(n);
      if (res.error) { setError(res.error); return; }
      setSaved(true);
    });
  };

  return (
    <div>
      <PageHeader badge="settings" title="Platform settings" subtitle="Configuration that applies platform-wide, not to one tenant" />

      <SectionCard title="Reseller depth" icon="sliders">
        <div className="grid max-w-sm gap-3">
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </p>
          )}
          {saved && (
            <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 p-2.5 text-sm text-on-tint-success">
              <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>Saved.</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            How many levels deep a Reseller may create a sub-reseller under itself. Day-one usage and
            UI assume Atlas → Reseller → Client (depth 1); sub-resellers become available the moment
            this is raised, with no schema change needed.
          </p>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Max reseller depth
            <input
              type="number" min={1} value={depth} onChange={(e) => setDepth(e.target.value)}
              disabled={!canEdit}
              className={`${fieldClass} disabled:opacity-60`}
            />
          </label>
          {canEdit ? (
            <Button variant="primary" icon="check" disabled={pending || !depth} loading={pending} onClick={save}>
              Save
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Restricted to the root Platform Owner account.</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
