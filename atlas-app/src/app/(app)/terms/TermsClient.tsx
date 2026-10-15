'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { savePolicy, togglePolicyActive, acknowledge } from './actions';

interface PolicyRow {
  id: string;
  title: string;
  body: string;
  version: number;
  isActive: boolean;
  acknowledgedByMe: boolean;
  acknowledgedCount: number;
  updatedAt: string;
}

export function TermsClient({
  policies, canEdit, isSingleStore,
}: { policies: PolicyRow[]; canEdit: boolean; isSingleStore: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PolicyRow | 'new' | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  return (
    <div>
      <PageHeader
        badge="TP"
        title="Terms &amp; Policy"
        subtitle="Internal policies staff can read and acknowledge"
        actions={canEdit && isSingleStore ? (
          <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>
            Add Policy
          </Button>
        ) : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add a policy or acknowledge one.</p>
        </Card>
      )}

      {policies.length === 0 ? (
        <SectionCard title="Policies" icon="file-text" bodyClassName="p-0">
          <EmptyState icon="file-text" title="No policies yet" hint="Add one for staff to read and acknowledge." />
        </SectionCard>
      ) : (
        <Card className="overflow-hidden p-0">
          <ListFilter
            rows={policies}
            noun="policies"
            placeholder="Policy title, or a word in it…"
            searchOn={(p) => [p.title, p.body]}
            chipOf={(p) => (p.acknowledgedByMe ? 'read' : 'unread')}
            chipLabel="Mine"
            chips={[
              { value: 'unread', label: 'Not acknowledged by me', count: policies.filter((p) => !p.acknowledgedByMe).length },
              { value: 'read', label: 'Acknowledged', count: policies.filter((p) => p.acknowledgedByMe).length },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every policy." />
            ) : (
        <div className="space-y-3 p-3">
          {shown.map((p) => (
            <SectionCard
              key={p.id}
              title={p.title}
              icon="file-text"
              action={(
                <div className="flex items-center gap-2">
                  {!p.isActive && <Badge tone="neutral">Inactive</Badge>}
                  <Badge tone="neutral">v{p.version}</Badge>
                  <Badge tone={p.acknowledgedByMe ? 'success' : 'warning'} icon={p.acknowledgedByMe ? 'check-circle' : 'alert-circle'}>
                    {p.acknowledgedByMe ? 'You acknowledged this' : 'Not yet acknowledged'}
                  </Badge>
                </div>
              )}
            >
              <p className="whitespace-pre-line text-sm text-foreground/90">{p.body}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <p className="text-xs text-muted-foreground">
                  {p.acknowledgedCount} acknowledgement{p.acknowledgedCount === 1 ? '' : 's'} for this version
                </p>
                <div className="flex gap-2">
                  {!p.acknowledgedByMe && isSingleStore && (
                    <Button size="sm" variant="primary" loading={busy === `ack-${p.id}`} onClick={() => act(`ack-${p.id}`, () => acknowledge(p.id))}>
                      I have read this
                    </Button>
                  )}
                  {canEdit && isSingleStore && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === `active-${p.id}`}
                        onClick={() => act(`active-${p.id}`, () => togglePolicyActive(p.id, !p.isActive))}
                      >
                        {p.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
            ))}
          </ListFilter>
        </Card>
      )}

      {editing && (
        <PolicyForm
          policy={editing === 'new' ? null : editing}
          busy={busy === 'save'}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act('save', () => savePolicy(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PolicyForm({
  policy, busy, onClose, onSave,
}: {
  policy: PolicyRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { title: string; body: string }) => void;
}) {
  const [title, setTitle] = useState(policy?.title ?? '');
  const [body, setBody] = useState(policy?.body ?? '');

  return (
    <Modal
      title={policy ? 'Edit policy' : 'Add policy'}
      subtitle={policy ? 'Saving bumps the version - everyone will need to re-acknowledge.' : undefined}
      icon="file-text"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !body.trim()}
            onClick={() => onSave({ title: title.trim(), body: body.trim() })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Title" required htmlFor="pol-title">
          <input id="pol-title" value={title} onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Policy text" required htmlFor="pol-body">
          <textarea id="pol-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}
