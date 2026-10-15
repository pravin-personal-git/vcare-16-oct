'use client';

import { newestFirst, oldestFirst } from '@/lib/card-list';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PageHeader, Badge, Card, EmptyState, type BadgeTone } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { LocationCapture, type CapturedLocation } from '@/components/ui/LocationCapture';
import { raiseComplaint, type RaiseComplaintState } from './actions';
import type { PortalComplaintRow, PurchasedProduct } from '@/server/portal';
import type { ComplaintFieldConfigRow } from '@/server/complaints';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { stdRequired, stdShown, type FieldSetup } from '@/lib/custom-fields';
import { customerLabel, statusTone, DONE } from '@/lib/job-flow';
import { ListFilter } from '@/components/ui/ListFilter';

// Customer words and colours come from the job rulebook (lib/job-flow).
const DONE_STATUSES = new Set<string>(DONE);
const STATUS_TONE = new Proxy({} as Record<string, BadgeTone>, { get: (_t, s: string) => statusTone(s) });
const STATUS_LABEL = new Proxy({} as Record<string, string>, { get: (_t, s: string) => customerLabel(s) });

const fieldClass = 'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground';
const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function ComplaintsClient({
  complaints, purchases, fieldConfigs, rules,
}: {
  complaints: PortalComplaintRow[];
  purchases: PurchasedProduct[];
  fieldConfigs: ComplaintFieldConfigRow[];
  rules: FieldSetup;
}) {
  const [showRaise, setShowRaise] = useState(false);

  return (
    <div>
      <PageHeader
        badge="alert-circle"
        title="My Complaints"
        subtitle="Raise one against something you've purchased, and track its progress here"
        actions={
          <button type="button" onClick={() => setShowRaise(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg transition hover:opacity-90">
            <Icon name="plus" className="h-3.5 w-3.5" />
            Raise a complaint
          </button>
        }
      />

      {complaints.length === 0 ? (
        <Card>
          <EmptyState icon="alert-circle" title="No complaints raised yet"
            hint="Something wrong with a purchase? Raise it above." />
        </Card>
      ) : (
        /* D17 applies to the customer's own list too - it was the phone app and
           the portal that shipped with no search at all, because F1's Definition
           of Done only ever said "list screens" and everyone read that as the
           website. A customer with two years of complaints needs to find one. */
        <Card className="overflow-hidden p-0">
          <ListFilter
            rows={complaints}
            // Date filter and sort, newest first (9 Oct 2026).
            dates={[{ key: 'raised', label: 'Raised on', of: (r) => r.createdAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
            noun="complaints"
            placeholder="Complaint number, what went wrong, item…"
            searchOn={(c) => [c.complaintNo, c.description, c.productName, STATUS_LABEL[c.status] ?? c.status]}
            chipOf={(c) => (DONE_STATUSES.has(c.status) ? 'closed' : 'open')}
            chipLabel="Status"
            chips={[
              { value: 'open', label: 'Open', count: complaints.filter((c) => !DONE_STATUSES.has(c.status)).length },
              { value: 'closed', label: 'Closed', count: complaints.filter((c) => DONE_STATUSES.has(c.status)).length },
            ]}
          >
            {(shown) => (
              shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches"
                  hint="Clear the search to see all your complaints." />
              ) : (
                <div className="space-y-2 p-3">
                  {shown.map((c) => (
                    <Link key={c.id} href={`/portal/complaints/${c.id}`} className="block">
                      <Card className="p-3.5 transition hover:border-brand/40 hover:shadow-md">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-brand">{c.complaintNo}</span>
                              <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                            </div>
                            <p className="mt-1 text-sm">{c.description}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.productName ?? 'No item specified'}
                              {c.assignedTechnicianName && ` · Technician: ${c.assignedTechnicianName}`}
                            </p>
                          </div>
                          <p className="shrink-0 text-xs text-muted-foreground">{fmtDate(c.createdAt)}</p>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )
            )}
          </ListFilter>
        </Card>
      )}

      {showRaise && (
        <RaiseComplaintDialog purchases={purchases} fieldConfigs={fieldConfigs} rules={rules} onClose={() => setShowRaise(false)} />
      )}
    </div>
  );
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled}
      className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50">
      {pending ? 'Raising…' : 'Raise complaint'}
    </button>
  );
}

function RaiseComplaintDialog({
  purchases, fieldConfigs, rules, onClose,
}: {
  purchases: PurchasedProduct[];
  fieldConfigs: ComplaintFieldConfigRow[];
  rules: FieldSetup;
  onClose: () => void;
}) {
  /** Field rules, same as the staff form: never ask for a switched-off field. */
  const show = (k: string) => stdShown(rules, k);
  const need = (k: string) => stdShown(rules, k) && stdRequired(rules, k);

  const [state, formAction] = useActionState<RaiseComplaintState, FormData>(raiseComplaint, {});
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<CapturedLocation | null>(null);

  // Closing must happen as an effect, not during render - calling onClose()
  // (which sets state on the parent ComplaintsClient) directly in the render
  // body is exactly the "setState while rendering a different component"
  // mistake, and only appears to work by accident of timing.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  if (state.ok) return null;

  return (
    <DialogFrame label="Raise a complaint" onClose={onClose} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-4" closeOnBackdrop>
      <form action={formAction} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card shadow-overlay">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Raise a complaint</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="grid gap-3 p-4">
          {state.error && <p className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-on-tint-danger">{state.error}</p>}

          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Which item is this about?
            <select name="productId" className={fieldClass}>
              <option value="">{purchases.length === 0 ? 'No purchases on file - describe it below' : 'Choose the item…'}</option>
              {purchases.map((p) => <option key={p.productId} value={p.productId}>{p.productName}</option>)}
            </select>
          </label>

          {show('siteLocation') && (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Site location{need('siteLocation')
                ? <span className="text-danger"> *</span>
                : <span className="text-muted-foreground/70"> (optional)</span>}
            </p>
            <LocationCapture value={location} onChange={setLocation} required={need('siteLocation')} />
            {location && (
              <>
                <input type="hidden" name="siteLat" value={location.lat} />
                <input type="hidden" name="siteLng" value={location.lng} />
                <input type="hidden" name="siteSource" value={location.source} />
              </>
            )}
          </div>
          )}

          {show('siteNote') && (
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Site note{need('siteNote')
                ? <span className="text-danger"> *</span>
                : <span className="text-muted-foreground/70"> (optional)</span>}
              <input name="siteLocation" className={fieldClass} placeholder="Where the equipment is installed" />
            </label>
          )}

          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            What&apos;s wrong
            <textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} className={fieldClass} placeholder="Describe the issue" required />
          </label>

          {fieldConfigs.map((f) => (
            <label key={f.id} className="grid gap-1 text-xs font-medium text-muted-foreground">
              {f.label}{f.required && <span className="text-danger"> *</span>}
              {f.fieldType === 'select' ? (
                <select name={`field:${f.fieldKey}`} className={fieldClass} required={f.required}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.fieldType === 'boolean' ? (
                <select name={`field:${f.fieldKey}`} className={fieldClass} required={f.required}>
                  <option value="">Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input
                  name={`field:${f.fieldKey}`}
                  type={f.fieldType === 'number' ? 'number' : 'text'}
                  className={fieldClass}
                  required={f.required}
                />
              )}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <SubmitButton disabled={!description.trim() || (need('siteLocation') && !location)} />
        </div>
      </form>
    </DialogFrame>
  );
}
