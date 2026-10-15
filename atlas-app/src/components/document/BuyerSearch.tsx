'use client';

import { useCallback, useRef } from 'react';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';

/**
 * Type-to-search customer (or lead) picker for documents (26 Sep 2026).
 *
 * Replaces a <select> holding every customer. Type a name, company, phone,
 * code, GSTIN or city; the server returns the 20 best matches with the full
 * row, and picking one hands that row to the form so it fills itself in.
 * Leaving it empty and typing the details into the fields below is still a
 * walk-in / new customer, exactly as before.
 */
export interface PickableRow {
  id: string;
  code?: string | null;
  name: string;
  company: string | null;
  phone: string;
  city: string | null;
  gstin?: string | null;
}

export function BuyerSearch<T extends PickableRow>({
  id, selected, onPick, search, placeholder = 'Type a name, company, phone, GSTIN or city…', disabled,
}: {
  id?: string;
  /** What is chosen now - shown in the box. Null when nothing is picked. */
  selected: { id: string; label: string; sub?: string | null } | null;
  onPick: (row: T | null) => void;
  search: (q: string) => Promise<T[]>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const rows = useRef(new Map<string, T>());
  const find = useCallback(async (q: string): Promise<SearchOption[]> => {
    const found = await search(q);
    for (const r of found) rows.current.set(r.id, r);
    return found.map((r) => ({
      id: r.id,
      label: r.company ? `${r.company} - ${r.name}` : r.name,
      sub: [r.code, r.phone, r.city, r.gstin].filter(Boolean).join(' · '),
    }));
  }, [search]);

  return (
    <SearchSelect
      id={id}
      value={selected}
      disabled={disabled}
      placeholder={placeholder}
      search={find}
      onChange={(o) => onPick(o ? rows.current.get(o.id) ?? null : null)}
    />
  );
}
