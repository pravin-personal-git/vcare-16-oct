'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { customValuesAction, saveCustomValuesAction } from '@/app/actions/custom-fields';
import { formatCustomValue, type CustomValues, type FieldEntity } from '@/lib/custom-fields';
import { CustomFieldInputs, useFieldSetup } from './CustomFieldInputs';

/**
 * A record's extra fields on its detail page or drawer - read, and edited in
 * place (26 Sep 2026). Renders nothing when the branch has no extra fields for
 * this kind of record, so screens can drop it in unconditionally.
 */
export function CustomFieldsPanel({ entity, id, canEdit, className = 'rounded border border-border p-4' }: {
  entity: FieldEntity;
  id: string;
  canEdit: boolean;
  className?: string;
}) {
  const { setup, ready } = useFieldSetup(entity);
  const [values, setValues] = useState<CustomValues | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    customValuesAction(entity, id).then((v) => { if (live) setValues(v ?? {}); });
    return () => { live = false; };
  }, [entity, id]);

  if (!ready || !setup.custom.length || values === null) return null;

  const save = (form: FormData) => {
    setError(null);
    start(async () => {
      const r = await saveCustomValuesAction(entity, id, form);
      if (r.error) { setError(r.error); return; }
      setValues(await customValuesAction(entity, id) ?? {});
      setEditing(false);
    });
  };

  return (
    <div className={className}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">More details</h3>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <Icon name="pencil" className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <form action={save} className="grid gap-3">
          <CustomFieldInputs configs={setup.custom} values={values} />
          {error && <p role="alert" className="rounded bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(false); setError(null); }}
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
            <button type="submit" disabled={pending}
              className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {setup.custom.map((c) => {
            const text = formatCustomValue(c, values[c.fieldKey]);
            return (
              <div key={c.id} className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs text-muted-foreground">{c.label}</dt>
                <dd className="min-w-0 flex-1 break-words">
                  {text && c.fieldType === 'url' && /^https?:\/\//i.test(text)
                    ? <a href={text} target="_blank" rel="noreferrer" className="text-brand hover:underline">{text}</a>
                    : text || '-'}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
