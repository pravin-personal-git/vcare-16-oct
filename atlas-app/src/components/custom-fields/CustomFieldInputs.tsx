'use client';

import { useEffect, useState } from 'react';
import { fieldSetupAction } from '@/app/actions/custom-fields';
import {
  EMPTY_SETUP, cfName, type CustomValues, type FieldConfig, type FieldEntity, type FieldSetup,
} from '@/lib/custom-fields';

/**
 * The owner's extra fields inside a form (26 Sep 2026). Plain named inputs
 * (`cf_<key>`), so they ride along with whatever FormData the form already
 * posts; the server checks them against the same definitions.
 */

/** The branch's field setup, loaded when a form opens. */
export function useFieldSetup(entity: FieldEntity): { setup: FieldSetup; ready: boolean } {
  const [setup, setSetup] = useState<FieldSetup | null>(null);
  useEffect(() => {
    let live = true;
    fieldSetupAction(entity).then((s) => { if (live) setSetup(s); }).catch(() => { if (live) setSetup(EMPTY_SETUP); });
    return () => { live = false; };
  }, [entity]);
  return { setup: setup ?? EMPTY_SETUP, ready: !!setup };
}

export function CustomFieldInputs({ configs, values = {}, className = 'grid gap-4 sm:grid-cols-2' }: {
  configs: FieldConfig[];
  values?: CustomValues;
  className?: string;
}) {
  if (!configs.length) return null;
  return (
    <div className={className}>
      {configs.map((c) => <CustomFieldInput key={c.id} config={c} value={values[c.fieldKey]} />)}
    </div>
  );
}

function CustomFieldInput({ config: c, value }: { config: FieldConfig; value: CustomValues[string] | undefined }) {
  const name = cfName(c.fieldKey);
  const id = `cf-${c.fieldKey}`;
  const label = (
    <span className="field-label">
      {c.label} {c.required && <span className="text-danger">*</span>}
    </span>
  );
  const text = value === null || value === undefined || Array.isArray(value) ? '' : String(value);

  if (c.fieldType === 'boolean') {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name={name} defaultChecked={value === true} />
        {c.label} {c.required && <span className="text-danger">*</span>}
      </label>
    );
  }
  if (c.fieldType === 'multiselect') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="field-label">{c.label} {c.required && <span className="text-danger">*</span>}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded border border-border px-3 py-2">
          {c.options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={name} value={o} defaultChecked={picked.includes(o)} /> {o}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (c.fieldType === 'select') {
    return (
      <label className="block" htmlFor={id}>
        {label}
        <select id={id} name={name} defaultValue={text} required={c.required} className="field-input">
          <option value="">- Select -</option>
          {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
          {text && !c.options.includes(text) && <option value={text}>{text}</option>}
        </select>
      </label>
    );
  }
  if (c.fieldType === 'textarea') {
    return (
      <label className="block sm:col-span-2" htmlFor={id}>
        {label}
        <textarea id={id} name={name} defaultValue={text} required={c.required} rows={2} className="field-input" />
      </label>
    );
  }
  const type = { number: 'number', date: 'date', phone: 'tel', email: 'email', url: 'url' }[c.fieldType as string] ?? 'text';
  return (
    <label className="block" htmlFor={id}>
      {label}
      <input
        id={id} name={name} type={type} defaultValue={text} required={c.required}
        step={c.fieldType === 'number' ? 'any' : undefined}
        maxLength={c.fieldType === 'phone' ? 10 : undefined}
        inputMode={c.fieldType === 'phone' ? 'numeric' : undefined}
        placeholder={c.fieldType === 'url' ? 'https://' : undefined}
        className="field-input"
      />
    </label>
  );
}
