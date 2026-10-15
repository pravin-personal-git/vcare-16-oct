'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { ListFilter } from '@/components/ui/ListFilter';
import { saveCourier, toggleCourierActive } from './actions';

interface CourierRow {
  id: string;
  name: string;
  contactPhone: string | null;
  trackingUrlTemplate: string | null;
  notes: string | null;
  isActive: boolean;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

/**
 * Courier & Shipping.
 *
 * Notable in the reference app for being dead - `/courier` there just
 * redirects to the dashboard, despite quotations carrying a courier field.
 * Built here rather than left as a shell, because the field it feeds is
 * already live on the quotation and order forms.
 */
export function CourierClient({
  couriers, canEdit, isSingleStore,
}: { couriers: CourierRow[]; canEdit: boolean; isSingleStore: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CourierRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(true);
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
        badge="CO"
        title="Courier & Shipping"
        subtitle="Courier partners the quotation and order forms pick from"
        actions={canEdit && isSingleStore ? (
          <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>
            Add Courier
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
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add or change a courier.</p>
        </Card>
      )}

      <SectionCard title={`${couriers.length} courier${couriers.length === 1 ? '' : 's'}`} icon="truck" bodyClassName="p-0">
        {couriers.length === 0 ? (
          <EmptyState icon="truck" title="No couriers yet" hint="Add one so it can be picked when dispatching an order." />
        ) : (
          /* Tier C in F1-SPEC §3.1: a settings list gets search, not the full
             grid - there is nothing here worth sorting or paging, and the row
             actions matter more than the columns would. */
          <ListFilter
            rows={couriers}
            noun="couriers"
            placeholder="Courier name, phone, notes…"
            searchOn={(c) => [c.name, c.contactPhone, c.notes]}
            chipOf={(c) => (c.isActive ? 'active' : 'inactive')}
            chipLabel="Status"
            chips={[
              { value: 'active', label: 'Active', count: couriers.filter((c) => c.isActive).length },
              { value: 'inactive', label: 'Inactive', count: couriers.filter((c) => !c.isActive).length },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every courier." />
            ) : (
          <div className="divide-y divide-border">
            {shown.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{c.name}</p>
                    {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
                    {c.trackingUrlTemplate && <Badge tone="brand" icon="external-link">Tracking link</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[c.contactPhone, c.notes].filter(Boolean).join(' · ') || 'No contact details on file'}
                  </p>
                </div>
                {canEdit && isSingleStore && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy}
                      onClick={() => act(() => toggleCourierActive(c.id, !c.isActive))}
                    >
                      {c.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {editing && (
        <CourierForm
          courier={editing === 'new' ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act(() => saveCourier(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CourierForm({
  courier, busy, onClose, onSave,
}: {
  courier: CourierRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    name: string; contactPhone: string | null; trackingUrlTemplate: string | null; notes: string | null;
  }) => void;
}) {
  const [name, setName] = useState(courier?.name ?? '');
  const [contactPhone, setContactPhone] = useState(courier?.contactPhone ?? '');
  const [trackingUrlTemplate, setTrackingUrlTemplate] = useState(courier?.trackingUrlTemplate ?? '');
  const [notes, setNotes] = useState(courier?.notes ?? '');

  return (
    <Modal
      title={courier ? 'Edit courier' : 'Add courier'}
      icon="truck"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() => onSave({
              name: name.trim(),
              contactPhone: contactPhone.trim() || null,
              trackingUrlTemplate: trackingUrlTemplate.trim() || null,
              notes: notes.trim() || null,
            })}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Name" required htmlFor="co-name">
          <input id="co-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Contact phone" htmlFor="co-phone">
          <input id="co-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field
          label="Tracking URL template"
          hint="Use {awb} where the AWB number goes, e.g. https://track.example.com/{awb}"
          htmlFor="co-url"
        >
          <input id="co-url" value={trackingUrlTemplate} onChange={(e) => setTrackingUrlTemplate(e.target.value)} className={`${inputClass} font-mono`} />
        </Field>
        <Field label="Notes" htmlFor="co-notes">
          <textarea id="co-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}
