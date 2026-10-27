'use client';

import { useCallback, useMemo } from 'react';
import { SearchSelect, type SearchOption } from './SearchSelect';

/**
 * A `<select>` you can type into (28 Oct 2026, Vcare): the same search box as
 * SearchSelect, over a list the page already has - so a form with every
 * supplier or product in a dropdown becomes "type a few letters" without a
 * server round trip. Matches every word typed, in any order, against the
 * label and the sub-line.
 */
export function PickList({ id, label, options, value, onChange, placeholder, disabled }: {
  id?: string;
  label?: string;
  options: SearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const picked = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const search = useCallback(async (q: string) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length
      ? options.filter((o) => { const hay = `${o.label} ${o.sub ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      : options;
    return hits.slice(0, 30);
  }, [options]);
  return (
    <SearchSelect id={id} label={label} value={picked} onChange={(o) => onChange(o?.id ?? '')} search={search}
      placeholder={placeholder ?? 'Type to search…'} disabled={disabled} />
  );
}
