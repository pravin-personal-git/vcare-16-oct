'use client';

import { useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/Layout';
import { inStockSerialsAction } from './actions';

/**
 * WHICH SERIALS GO TO THE CUSTOMER (10 Oct 2026, live test of 9 Oct).
 *
 * Saving a counter invoice takes stock out at once, and for a serial product
 * Atlas used to bind the OLDEST units on the shelf - nobody was asked which
 * cameras were actually in the box. So the warranty, the complaint picker and
 * every repair later on followed serials the customer never had. Here the
 * person billing ticks the exact units, one per quantity.
 */
export interface SerialLine { key: string; productId: string | null; productName: string; qty: number }
export type SerialPicks = Record<string, string[]>;

export function useSerialStock(lines: SerialLine[]) {
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))].sort().join(',');
  const [stock, setStock] = useState<Map<string, { id: string; serialNo: string }[]>>(new Map());
  useEffect(() => {
    if (!ids) { setStock(new Map()); return; }
    let live = true;
    inStockSerialsAction(ids.split(',')).then((rows) => { if (live) setStock(new Map(rows.map((r) => [r.productId, r.units]))); }).catch(() => null);
    return () => { live = false; };
  }, [ids]);
  return stock;
}

/** What is still to tick, or null when every serial line is complete. */
export function serialPickError(lines: SerialLine[], stock: Map<string, { id: string }[]>, picks: SerialPicks): string | null {
  for (const l of lines) {
    const units = l.productId ? stock.get(l.productId) : undefined;
    if (!units) continue;
    const need = Math.min(l.qty, units.length);
    const got = (picks[l.key] ?? []).filter((id) => units.some((u) => u.id === id)).length;
    if (got !== need) return `Tick the ${need} serial${need === 1 ? '' : 's'} of ${l.productName} going to the customer (${got} ticked).`;
  }
  return null;
}

export function SerialPickerCard({ lines, stock, picks, onChange }: {
  lines: SerialLine[]; stock: Map<string, { id: string; serialNo: string }[]>; picks: SerialPicks; onChange: (p: SerialPicks) => void;
}) {
  const [find, setFind] = useState<Record<string, string>>({});
  const serialLines = lines.filter((l) => l.productId && stock.has(l.productId));
  if (!serialLines.length) return null;
  return (
    <SectionCard title="Serial numbers" icon="package">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Tick the exact units in the customer&apos;s box. Their warranty and every later complaint follow these serials.</p>
        {serialLines.map((l) => {
          const units = stock.get(l.productId!)!;
          const picked = picks[l.key] ?? [];
          const need = Math.min(l.qty, units.length);
          const q = (find[l.key] ?? '').trim().toLowerCase();
          const shown = units.filter((u) => !q || u.serialNo.toLowerCase().includes(q) || picked.includes(u.id));
          const toggle = (id: string) => onChange({ ...picks, [l.key]: picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= l.qty ? picked : [...picked, id] });
          return (
            <div key={l.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{l.productName}</p>
                <p className={`text-xs ${picked.length === need ? 'text-success' : 'text-warning'}`}>{picked.length} of {l.qty} ticked{units.length < l.qty ? ` - only ${units.length} on the shelf` : ''}</p>
              </div>
              {units.length > 8 && (
                <input aria-label={`Find a serial of ${l.productName}`} value={find[l.key] ?? ''} onChange={(e) => setFind({ ...find, [l.key]: e.target.value })} placeholder="Type or scan a serial" className="field-input mt-1.5 font-mono" />
              )}
              {units.length === 0
                ? <p className="mt-1 text-xs text-muted-foreground">None of this product is on the shelf with a serial on record.</p>
                : (
                  <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {shown.map((u) => (
                      <label key={u.id} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${picked.includes(u.id) ? 'border-brand bg-brand/10' : 'border-border'}`}>
                        <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
                        {u.serialNo}
                      </label>
                    ))}
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
