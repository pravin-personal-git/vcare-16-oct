'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import {
  FIELD_ENTITIES, FIELD_PRESETS, FIELD_TYPES, canSwitchOff, hasOptions, supportsCustomFields,
  type FieldConfig, type FieldEntity, type FieldType, type StandardFieldState,
} from '@/lib/custom-fields';
import {
  deleteFieldAction, moveFieldAction, saveFieldAction, setFieldActiveAction, setStandardFieldAction,
} from '@/app/actions/custom-fields';

/**
 * Settings > Custom Fields (26 Sep 2026).
 *
 * Two jobs on one screen, per kind of record: switch the built-in optional
 * fields on, off or mandatory (birthday and anniversary were the ask), and add
 * any extra field of any type. Changes reach the Add / Edit forms at once.
 */
interface Props {
  entity: FieldEntity;
  custom: FieldConfig[];
  standard: StandardFieldState[];
  categories: { id: string; name: string }[];
  canEdit: boolean;
  scopeIsAll: boolean;
  storeName: string;
}

type Draft = { id?: string; label: string; fieldType: FieldType; options: string; required: boolean; showInList: boolean; categoryId: string };

export function CustomFieldsClient({ entity, custom, standard, categories, canEdit, scopeIsAll, storeName }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FieldConfig | null>(null);
  const meta = FIELD_ENTITIES.find((e) => e.key === entity)!;
  const editable = canEdit && !scopeIsAll;
  const taken = new Set(custom.map((c) => c.label.toLowerCase()));
  const presets = (FIELD_PRESETS[entity] ?? []).filter((p) => !taken.has(p.label.toLowerCase()));
  // Complaints, quotations, orders and invoices have no owner-defined fields
  // here: you can decide what the built-in ones do, not invent new ones.
  // (Complaint custom fields live on the complaint screen itself.)
  const hasCustom = supportsCustomFields(entity);

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  };

  const openNew = (p?: { label: string; fieldType: FieldType; options?: string[] }) => setDraft({
    label: p?.label ?? '', fieldType: p?.fieldType ?? 'text', options: (p?.options ?? []).join('\n'),
    required: false, showInList: false, categoryId: '',
  });

  return (
    <div>
      <PageHeader
        badge="CF"
        title="Custom Fields"
        subtitle={scopeIsAll ? 'Your own fields, and which built-in ones appear' : `Your own fields, and which built-in ones appear · ${storeName}`}
        actions={editable ? <Button variant="primary" icon="plus" onClick={() => openNew()}>Add field</Button> : undefined}
      />

      {scopeIsAll && (
        <Card className="mb-3 border-warning/40 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span><strong>All Company</strong> - each branch keeps its own fields. Select a single store to see and change them.</span>
          </p>
        </Card>
      )}
      {!canEdit && !scopeIsAll && (
        <Card className="mb-3 p-3 text-sm text-muted-foreground">Only an owner or admin can change these. You can see what is set up.</Card>
      )}
      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </p>
        </Card>
      )}

      <nav aria-label="Record type" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {FIELD_ENTITIES.map((e) => (
          <a key={e.key} href={`/settings/custom-fields?for=${e.key}`} aria-current={e.key === entity ? 'page' : undefined}
            className={`whitespace-nowrap rounded px-4 py-1.5 text-sm ${e.key === entity ? 'bg-brand/10 font-semibold text-brand' : 'hover:bg-muted'}`}>
            {e.label}
          </a>
        ))}
      </nav>

      {!scopeIsAll && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="grid gap-4">
            {hasCustom && (
            <SectionCard title={`Extra ${meta.singular} fields`} icon="sliders" bodyClassName="p-0">
              {custom.length === 0 ? (
                <EmptyState icon="sliders" title="No extra fields yet"
                  hint={`Add a field and it appears on the Add / Edit ${meta.singular} form straight away.`} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-start text-micro uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 text-start font-semibold">Field</th>
                        <th className="px-4 py-2 text-start font-semibold">Type</th>
                        {entity === 'product' && <th className="px-4 py-2 text-start font-semibold">Applies to</th>}
                        <th className="px-4 py-2 text-start font-semibold">Rules</th>
                        <th className="w-40 px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {custom.map((c, i) => (
                        <tr key={c.id} className={`border-b border-border last:border-0 ${c.isActive ? '' : 'bg-muted/30 text-muted-foreground'}`}>
                          <td className="px-4 py-2">
                            <span className="font-medium">{c.label}</span>
                            {hasOptions(c.fieldType) && (
                              <span className="block max-w-xs truncate text-xs text-muted-foreground">{c.options.join(' · ')}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">{FIELD_TYPES.find((t) => t.key === c.fieldType)?.label}</td>
                          {entity === 'product' && <td className="px-4 py-2">{c.categoryName ?? 'All products'}</td>}
                          <td className="px-4 py-2">
                            <span className="flex flex-wrap gap-1">
                              {c.required && <Badge tone="warning">Required</Badge>}
                              {c.showInList && <Badge tone="info">In list</Badge>}
                              {!c.isActive && <Badge tone="neutral">Hidden</Badge>}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {editable && (
                              <span className="flex items-center justify-end gap-1">
                                <IconBtn label="Move up" icon="chevron-up" disabled={pending || i === 0} onClick={() => run(() => moveFieldAction(entity, c.id, -1))} />
                                <IconBtn label="Move down" icon="chevron-down" disabled={pending || i === custom.length - 1} onClick={() => run(() => moveFieldAction(entity, c.id, 1))} />
                                <IconBtn label="Edit" icon="pencil" disabled={pending} onClick={() => setDraft({
                                  id: c.id, label: c.label, fieldType: c.fieldType, options: c.options.join('\n'),
                                  required: c.required, showInList: c.showInList, categoryId: c.categoryId ?? '',
                                })} />
                                <IconBtn label={c.isActive ? 'Hide' : 'Show again'} icon={c.isActive ? 'eye-off' : 'eye'} disabled={pending}
                                  onClick={() => run(() => setFieldActiveAction(c.id, !c.isActive))} />
                                <IconBtn label="Delete" icon="trash" disabled={pending} onClick={() => setConfirmDelete(c)} />
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
            )}

            {standard.length > 0 && (
              <SectionCard title={`${meta.label}: field rules`} icon="check-circle" bodyClassName="p-0">
                <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                  Switch off what your business never fills in - it leaves the form, and the server stops asking for it.
                  Mark as required what must never be skipped. These are the built-in fields; name and phone are always on.
                </p>
                <ul>
                  {standard.map((f) => {
                    const locked = !canSwitchOff(f);
                    return (
                      <li key={f.key} className="border-b border-border px-4 py-2 text-sm last:border-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`min-w-0 flex-1 ${f.shown ? 'font-medium' : 'text-muted-foreground line-through'}`}>{f.label}</span>
                          <label className={`flex items-center gap-1.5 ${locked ? 'opacity-40' : ''}`}>
                            <input type="checkbox" checked={locked ? true : f.shown} disabled={!editable || pending || locked}
                              onChange={(e) => run(() => setStandardFieldAction(entity, f.key, e.target.checked, f.required))} />
                            On the form
                          </label>
                          <label className={`flex items-center gap-1.5 ${f.shown ? '' : 'opacity-40'}`}>
                            <input type="checkbox" checked={f.required} disabled={!editable || pending || !f.shown}
                              onChange={(e) => run(() => setStandardFieldAction(entity, f.key, true, e.target.checked))} />
                            Required
                          </label>
                        </div>
                        {/* D15/D16: nothing is switched off without saying what happens instead. */}
                        {f.note && (
                          <p className={`mt-1 text-xs ${locked ? 'text-warning' : 'text-muted-foreground'}`}>{f.note}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </SectionCard>
            )}
          </div>

          {editable && presets.length > 0 && (
            <SectionCard title="Quick add" icon="sparkles" className="lg:self-start">
              <p className="mb-2 text-xs text-muted-foreground">Fields other businesses often keep on a {meta.singular}. One click opens it ready to save.</p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button key={p.label} type="button" onClick={() => openNew(p)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:border-brand hover:text-brand">
                    <Icon name="plus" className="h-3 w-3" /> {p.label}
                  </button>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {draft && (
        <FieldDialog
          draft={draft} entity={entity} categories={categories} busy={pending}
          onChange={setDraft}
          onClose={() => { setDraft(null); setError(null); }}
          onSave={() => run(() => saveFieldAction(entity, {
            label: draft.label, fieldType: draft.fieldType,
            options: draft.options.split('\n'), required: draft.required, showInList: draft.showInList,
            categoryId: draft.categoryId || null,
          }, draft.id), () => setDraft(null))}
          error={error}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.label}"?`}
          message="The field leaves every form. Anything already typed into it is kept out of sight, and comes back if you add a field with the same name again. To only take it off the forms for now, use Hide instead."
          confirmLabel="Delete"
          tone="danger"
          busy={pending}
          onConfirm={() => run(() => deleteFieldAction(confirmDelete.id), () => setConfirmDelete(null))}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function IconBtn({ label, icon, onClick, disabled }: { label: string; icon: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
      <Icon name={icon as never} className="h-4 w-4" />
    </button>
  );
}

function FieldDialog({ draft, entity, categories, busy, onChange, onClose, onSave, error }: {
  draft: Draft; entity: FieldEntity; categories: { id: string; name: string }[]; busy: boolean;
  onChange: (d: Draft) => void; onClose: () => void; onSave: () => void; error: string | null;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const needsOptions = hasOptions(draft.fieldType);
  const ok = draft.label.trim() && (!needsOptions || draft.options.split('\n').some((o) => o.trim()));
  return (
    <Modal
      title={draft.id ? 'Edit field' : 'Add field'}
      subtitle="It appears on the form as soon as you save."
      icon="sliders"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!ok} onClick={onSave}>{draft.id ? 'Save changes' : 'Add field'}</Button>
      </>}
    >
      <div className="grid gap-4">
        <Field label="Field name" required htmlFor="cf-label">
          <input id="cf-label" autoFocus value={draft.label} maxLength={60} onChange={(e) => set('label', e.target.value)}
            placeholder="e.g. WhatsApp number" className="field-input" />
        </Field>
        <Field label="Type" required htmlFor="cf-type" hint={FIELD_TYPES.find((t) => t.key === draft.fieldType)?.hint}>
          <select id="cf-type" value={draft.fieldType} onChange={(e) => set('fieldType', e.target.value as FieldType)} className="field-input">
            {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        {needsOptions && (
          <Field label="Choices" required htmlFor="cf-options" hint="One per line.">
            <textarea id="cf-options" rows={5} value={draft.options} onChange={(e) => set('options', e.target.value)}
              placeholder={'Option one\nOption two'} className="field-input" />
          </Field>
        )}
        {entity === 'product' && (
          <Field label="Applies to" htmlFor="cf-cat" hint="A field only some products need - lens size on cameras - can be limited to their category.">
            <select id="cf-cat" value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)} className="field-input">
              <option value="">All products</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.required} onChange={(e) => set('required', e.target.checked)} />
            Required - the form will not save without it
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.showInList} onChange={(e) => set('showInList', e.target.checked)} />
            Show as a column in the list
          </label>
        </div>
        {error && <p role="alert" className="rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
      </div>
    </Modal>
  );
}
