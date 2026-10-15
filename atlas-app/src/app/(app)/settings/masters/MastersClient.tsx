'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  Badge, Card, EmptyState, Field, PageHeader, SectionCard,
} from '@/components/ui/Layout';
import type { MasterItem, MasterKind, MasterKindMeta } from '@/server/administration';
import { addMaster, editMaster, removeMaster } from './actions';

/**
 * Master data - the editable lists behind every dropdown.
 *
 * A left rail of lists, a table on the right. That shape is taken from the
 * reference app's System Setting screen, and it is the right one: there are
 * twelve lists and a tab strip would wrap onto three rows.
 *
 * The column that does the real work is **Used by**. A master row nobody
 * references can be deleted; one that is referenced can only be deactivated,
 * because deleting it would break the documents pointing at it. Showing the
 * count next to the buttons means the rule is visible before it is enforced,
 * rather than arriving as an error after a click.
 */

interface Props {
  kinds: MasterKindMeta[];
  activeKind: MasterKind;
  items: MasterItem[];
  /** Top-level categories, for the sub-category parent picker. */
  parents: { id: string; name: string }[];
  canEdit: boolean;
  scopeIsAll: boolean;
  storeName: string;
}

export function MastersClient({
  kinds, activeKind, items, parents, canEdit, scopeIsAll, storeName,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MasterItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const meta = kinds.find((k) => k.kind === activeKind)!;
  const editing = items.find((i) => i.id === editingId) ?? null;

  const visible = showInactive ? items : items.filter((i) => i.isActive);
  const inactiveCount = items.filter((i) => !i.isActive).length;

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setAdding(false);
        setEditingId(null);
        setConfirmDelete(null);
      }
    });
  };

  return (
    <div>
      <PageHeader
        badge="PA"
        title="Parameters"
        subtitle={
          scopeIsAll
            ? 'The editable lists behind every dropdown'
            : `The editable lists behind every dropdown · ${storeName}`
        }
        actions={
          canEdit && !scopeIsAll ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add {meta.singular}
            </Button>
          ) : undefined
        }
      />

      {scopeIsAll && (
        <Card className="mb-3 border-warning/40 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <strong>All Company</strong> - these lists belong to a branch, and each branch
              keeps its own. Select a single store to see and edit them.
            </span>
          </p>
        </Card>
      )}

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* ---- the rail --------------------------------------------------- */}
        <nav aria-label="Master lists" className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden p-1">
            {kinds.map((k) => {
              const active = k.kind === activeKind;
              return (
                <a
                  key={k.kind}
                  href={`/settings/masters?list=${k.kind}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition ${
                    active
                      ? 'bg-brand/10 font-semibold text-on-tint-brand'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <span>{k.label}</span>
                  {active && <Icon name="chevron-right" className="h-4 w-4" />}
                </a>
              );
            })}
          </Card>
        </nav>

        {/* ---- the list -------------------------------------------------- */}
        <SectionCard
          title={meta.label}
          icon="sliders"
          bodyClassName="p-0"
          action={
            inactiveCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="text-xs font-medium text-brand hover:underline"
              >
                {showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive
              </button>
            ) : undefined
          }
        >
          <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            {meta.description}
          </p>

          {visible.length === 0 ? (
            <EmptyState
              icon="sliders"
              // Not lowercased - "No gst rates yet" reads as a typo.
              title={scopeIsAll ? 'Select a store' : `No ${meta.label} yet`}
              hint={
                scopeIsAll
                  ? 'These lists are per branch.'
                  : 'Add the first one - it will appear in every dropdown that uses this list.'
              }
            />
          ) : (
            /* F1b / D17. Parameters holds every dropdown the business uses -
               categories, brands, tax rates, T&C templates. Some of those lists
               run to hundreds of entries and there was no way to find one. The
               Active/Inactive switch above still governs what reaches here. */
            <ListFilter
              rows={visible}
              noun="entries"
              placeholder="Name, category, code…"
              searchOn={(item) => [item.name, item.parentName, item.detail, item.hsnPattern]}
            >
              {(shown) => (shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see the whole list." />
              ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  {meta.supportsParent && <th className="px-4 py-2 font-semibold">Category</th>}
                  {meta.detailLabel && (
                    <th className="px-4 py-2 font-semibold">{meta.detailLabel}</th>
                  )}
                  {activeKind === 'taxRate' && <th className="px-4 py-2 font-semibold">HSN code</th>}
                  {activeKind === 'tncTemplate' && <th className="px-4 py-2 font-semibold">Filled in by default on</th>}
                  <th className="px-4 py-2 text-right font-semibold">Used by</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="w-24 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-border last:border-0 ${
                      item.isActive ? '' : 'bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    <td className="px-4 py-2 font-medium">{item.name}</td>
                    {meta.supportsParent && (
                      <td className="px-4 py-2 text-muted-foreground">{item.parentName ?? '-'}</td>
                    )}
                    {meta.detailLabel && (
                      <td className="px-4 py-2 text-muted-foreground">{item.detail ?? '-'}</td>
                    )}
                    {activeKind === 'taxRate' && (
                      <td className="px-4 py-2 font-mono text-muted-foreground">{item.hsnPattern ?? '-'}</td>
                    )}
                    {activeKind === 'tncTemplate' && (
                      <td className="px-4 py-2 text-muted-foreground">{defaultForLabel(item.defaultFor, parents) || '-'}</td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums">
                      {item.usageCount > 0 ? (
                        <span title="Records pointing at this row">{item.usageCount}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={item.isActive ? 'success' : 'neutral'}>
                        {item.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {canEdit && !scopeIsAll && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Edit"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => setEditingId(item.id)}
                            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Icon name="pencil" className="h-3.5 w-3.5" />
                          </button>

                          {activeKind !== 'taxRate' && (
                            <button
                              type="button"
                              title={item.isActive ? 'Deactivate' : 'Reactivate'}
                              aria-label={`${item.isActive ? 'Deactivate' : 'Reactivate'} ${item.name}`}
                              onClick={() =>
                                run(() => editMaster(activeKind, item.id, { isActive: !item.isActive }))
                              }
                              className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Icon name={item.isActive ? 'ban' : 'check'} className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            title={
                              item.usageCount > 0
                                ? `${item.usageCount} record(s) use this - deactivate instead`
                                : 'Delete'
                            }
                            aria-label={`Delete ${item.name}`}
                            disabled={item.usageCount > 0}
                            onClick={() => setConfirmDelete(item)}
                            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                          >
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              ))}
            </ListFilter>
          )}

          <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            A row nothing points at can be deleted. One that is in use is deactivated instead - it
            leaves every dropdown, and the documents that already reference it keep working.
          </p>
        </SectionCard>
      </div>

      {(adding || editing) && (
        <MasterForm
          meta={meta}
          parents={parents}
          item={editing}
          busy={pending}
          onClose={() => { setAdding(false); setEditingId(null); setError(null); }}
          onSubmit={(values) =>
            run(() =>
              editing
                ? editMaster(activeKind, editing.id, {
                  name: values.name, detail: values.detail, body: values.body,
                  hsnPattern: values.hsnPattern, defaultFor: values.defaultFor,
                })
                : addMaster(activeKind, values),
            )
          }
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          message="Nothing currently points at this row, so removing it is safe. This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          busy={pending}
          onConfirm={() => run(() => removeMaster(activeKind, confirmDelete.id))}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface FormValues {
  name: string;
  detail: string | null;
  parentId: string | null;
  body: string | null;
  hsnPattern: string | null;
  defaultFor: string[];
}

const DOC_TYPES = [
  { key: 'quotation', label: 'Quotations' },
  { key: 'sales_order', label: 'Sales orders' },
  { key: 'invoice', label: 'Invoices' },
];

function defaultForLabel(v: string[] | undefined, cats: { id: string; name: string }[]): string {
  return (v ?? []).map((k) => (k.startsWith('cat:')
    ? cats.find((c) => `cat:${c.id}` === k)?.name
    : DOC_TYPES.find((d) => d.key === k)?.label)).filter(Boolean).join(', ');
}

function MasterForm({
  meta, parents, item, busy, onClose, onSubmit,
}: {
  meta: MasterKindMeta;
  parents: { id: string; name: string }[];
  item: MasterItem | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [detail, setDetail] = useState(item?.detail?.replace('%', '') ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? parents[0]?.id ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [defaultFor, setDefaultFor] = useState<string[]>(item?.defaultFor ?? []);
  const toggleDefault = (k: string) => setDefaultFor((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));
  const [hsnPattern, setHsnPattern] = useState(item?.hsnPattern ?? '');

  const isTnc = meta.kind === 'tncTemplate';
  const isTaxRate = meta.kind === 'taxRate';
  const singular = meta.singular;

  return (
    <Modal
      title={item ? `Edit ${singular}` : `Add ${singular}`}
      subtitle={meta.description}
      icon="sliders"
      size={isTnc ? 'lg' : 'md'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim() || (isTnc && !body.trim())}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                detail: detail.trim() || null,
                parentId: meta.supportsParent ? parentId || null : null,
                body: isTnc ? body : null,
                hsnPattern: isTaxRate ? (hsnPattern.trim() || null) : null,
                defaultFor: isTnc ? defaultFor : [],
              })
            }
          >
            {item ? 'Save changes' : `Add ${singular}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" required htmlFor="master-name">
          <input
            id="master-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </Field>

        {meta.supportsParent && (
          <Field label="Parent category" required htmlFor="master-parent">
            <select
              id="master-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
            >
              {parents.length === 0 && <option value="">No categories yet</option>}
              {parents.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        )}

        {meta.detailLabel && (
          <Field label={meta.detailLabel} hint={meta.detailHint} htmlFor="master-detail">
            <input
              id="master-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </Field>
        )}

        {isTaxRate && (
          <Field label="HSN code" hint="Optional - the HSN code this rate applies to." htmlFor="master-hsn">
            <input
              id="master-hsn"
              value={hsnPattern}
              onChange={(e) => setHsnPattern(e.target.value)}
              placeholder="e.g. 8471"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </Field>
        )}

        {isTnc && (
          <Field
            label="Terms text"
            required
            htmlFor="master-body"
          >
            <textarea
              id="master-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'1. Prices are valid for 15 days.\n2. Delivery within 7 working days.'}
              className="w-full rounded-lg border border-border bg-card p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </Field>
        )}

        {isTnc && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium">Fill in by default on</legend>
            <p className="text-xs text-muted-foreground">
              A new document of a ticked type starts with these terms. A ticked category offers them
              whenever a product from it is on the document. Staff can still pick another template or edit the text.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {DOC_TYPES.map((d) => (
                <label key={d.key} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={defaultFor.includes(d.key)} onChange={() => toggleDefault(d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
            {parents.length > 0 && (
              <div className="thin-scroll flex max-h-32 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                {parents.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={defaultFor.includes(`cat:${c.id}`)} onChange={() => toggleDefault(`cat:${c.id}`)} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
