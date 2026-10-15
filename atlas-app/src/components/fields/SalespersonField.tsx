'use client';

import { useEffect, useState } from 'react';
import { Field } from '@/components/ui/Layout';
import { salespeopleAction } from '@/app/actions/form-options';
import type { SalespersonOption } from '@/server/salesperson';

/**
 * Who sold it, on the quotation, order and invoice forms (4 Oct 2026).
 *
 * Before this the forms had no such field and the server credited whoever
 * typed the document in - so an order booked from the office for a field
 * salesperson went onto the office's target and incentive. Settings > Custom
 * Fields already carried a "Salesperson" switch for all three; until now it
 * switched nothing.
 *
 * The list is the branch's active people, fetched once per visit like the
 * field rules. A new document opens on the signed-in person (`value` empty
 * means "me"), so entering your own sales is unchanged.
 */

type People = { me: string; people: SalespersonOption[] };
let cache: People | null = null;
let inFlight: Promise<People> | null = null;

function load(): Promise<People> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = salespeopleAction()
      .then((r) => { cache = r; return r; })
      .catch(() => ({ me: '', people: [] }))
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function SalespersonField({ value, onChange, required = false, id = 'salesperson' }: {
  /** The chosen user id; empty means the signed-in person. */
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  id?: string;
}) {
  const [data, setData] = useState<People | null>(cache);
  useEffect(() => {
    let alive = true;
    void load().then((r) => { if (alive) setData(r); });
    return () => { alive = false; };
  }, []);

  // Settle "me" into the form's own state, so what is saved is exactly what
  // the dropdown shows.
  useEffect(() => {
    if (!value && data?.me) onChange(data.me);
  }, [value, data, onChange]);

  const people = data?.people ?? [];
  const current = value || data?.me || '';
  // Someone who has since left, on an older document: still shown, so editing
  // the document does not silently move the sale to somebody else.
  const missing = current && data && !people.some((p) => p.id === current);

  return (
    <Field label="Salesperson" required={required} htmlFor={id}>
      <select id={id} value={current} onChange={(e) => onChange(e.target.value)} className="field-input" disabled={!data}>
        {!data && <option value="">Loading…</option>}
        {missing && <option value={current}>Former staff member</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.id === data?.me ? ' (me)' : ''}</option>
        ))}
      </select>
    </Field>
  );
}
