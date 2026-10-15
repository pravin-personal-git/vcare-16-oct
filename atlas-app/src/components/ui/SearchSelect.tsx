'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface SearchOption { id: string; label: string; sub?: string | null }

/**
 * A picker that asks the server for the best 20 matches as you type
 * (health check PERF-2) - instead of a <select> filled with every customer,
 * order or product in the branch. Keyboard: arrows move, Enter picks,
 * Escape closes.
 */
export function SearchSelect({
  value, onChange, search, placeholder = 'Type to search…', disabled, id, label,
}: {
  value: SearchOption | null;
  onChange: (o: SearchOption | null) => void;
  search: (q: string) => Promise<SearchOption[]>;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const h = setTimeout(() => {
      setBusy(true);
      search(q.trim()).then((r) => { if (live) { setItems(r); setActive(0); } }).catch(() => undefined).finally(() => { if (live) setBusy(false); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [q, open, search]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (o: SearchOption) => { onChange(o); setOpen(false); setQ(''); };

  if (value && !open) {
    return (
      <div className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate">{value.label}</p>
          {value.sub && <p className="truncate text-xs text-muted-foreground">{value.sub}</p>}
        </div>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setOpen(true); }} className="text-xs font-medium text-brand hover:underline">
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          disabled={disabled}
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="thin-scroll absolute inset-x-0 z-[260] mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-overlay">
          {items.length === 0 && !busy && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{q.trim() ? 'Nothing matches.' : 'Start typing to search.'}</li>
          )}
          {items.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? 'bg-brand/10' : ''}`}
            >
              <p className="truncate">{o.label}</p>
              {o.sub && <p className="truncate text-xs text-muted-foreground">{o.sub}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
