'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { loadCustomerEquipmentAction } from '../actions';

/**
 * WHAT IS BROKEN - picked serial by serial (10 Oct 2026, repair flow stage 2).
 *
 * Replaces the single "Equipment (from their purchase history)" dropdown,
 * which named a product and never the unit, so the warranty was guessed from
 * the last time the customer bought that product. Now:
 *
 *   - every serial this customer holds, with its invoice, warranty and AMC,
 *     ticked one or many;
 *   - products they bought without a serial, as before;
 *   - "not our product" rows for things bought elsewhere - brand, model,
 *     serial typed - which carry no warranty from us.
 */
export interface PickedItem {
  key: string;
  ours: boolean;
  stockUnitId: string | null;
  productId: string | null;
  equipmentName: string;
  serialNo: string | null;
}

type Option = Awaited<ReturnType<typeof loadCustomerEquipmentAction>>[number];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }) : null);

export function EquipmentPicker({ customerId, value, onChange, required }: {
  customerId: string; value: PickedItem[]; onChange: (v: PickedItem[]) => void; required?: boolean;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [q, setQ] = useState('');
  const [otherName, setOtherName] = useState('');
  const [otherSerial, setOtherSerial] = useState('');

  useEffect(() => {
    let live = true;
    setOptions(null);
    loadCustomerEquipmentAction(customerId).then((r) => { if (live) setOptions(r); }).catch(() => { if (live) setOptions([]); });
    return () => { live = false; };
  }, [customerId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (options ?? []).filter((o) => !needle || [o.name, o.code, o.serialNo, o.invoiceNo].some((v) => (v ?? '').toLowerCase().includes(needle)));
  }, [options, q]);

  const picked = new Set(value.map((v) => v.key));
  const toggle = (o: Option) => {
    if (picked.has(o.key)) onChange(value.filter((v) => v.key !== o.key));
    else onChange([...value, { key: o.key, ours: true, stockUnitId: o.stockUnitId, productId: o.productId, equipmentName: o.name, serialNo: o.serialNo }]);
  };
  const addOther = () => {
    const name = otherName.trim();
    if (!name) return;
    onChange([...value, { key: `x:${Date.now()}`, ours: false, stockUnitId: null, productId: null, equipmentName: name, serialNo: otherSerial.trim() || null }]);
    setOtherName(''); setOtherSerial('');
  };

  return (
    <div className="grid gap-2 text-xs font-medium text-muted-foreground">
      <span>What is broken - tick one or more{required && <span className="text-danger"> *</span>}</span>

      {options === null && <p className="font-normal">Loading what this customer has…</p>}
      {options !== null && options.length === 0 && <p className="font-normal">Nothing on file bought from us. Add it below as not ours, or describe it.</p>}
      {options !== null && options.length > 6 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by serial, name, code or invoice…" aria-label="Find equipment"
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-brand" />
      )}
      {shown.length > 0 && (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {shown.map((o) => (
            <li key={o.key}>
              <label className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm font-normal text-foreground hover:bg-muted/50 ${picked.has(o.key) ? 'bg-brand/[0.06]' : ''}`}>
                <input type="checkbox" checked={picked.has(o.key)} onChange={() => toggle(o)} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.name}{o.code ? <span className="ms-1.5 text-xs text-muted-foreground">{o.code}</span> : null}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {o.serialNo ? <span className="font-mono">S/N {o.serialNo}</span> : <span>no serial</span>}
                    {o.invoiceNo && <span>· {o.invoiceNo}</span>}
                    {o.installedOn && <span>· installed {day(o.installedOn)}</span>}
                    {o.stockUnitId && <Badge tone={o.partsFree ? 'success' : 'warning'}>{o.warrantyUntil ? `${o.partsFree ? 'Warranty' : 'Warranty over'} ${day(o.warrantyUntil)}` : 'No warranty'}</Badge>}
                    {o.stockUnitId && <Badge tone={o.labourFree ? 'success' : 'neutral'}>{o.labourFree ? `AMC to ${day(o.amcUntil)}` : 'No AMC'}</Badge>}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-1.5 rounded-lg border border-dashed border-border p-2.5">
        <span className="font-normal">Not our product - bought elsewhere (no warranty from us; work goes through an estimate)</span>
        <div className="flex flex-wrap gap-2">
          <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Brand and model, e.g. CP Plus CP-UNC-TA21" aria-label="Brand and model"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-brand" />
          <input value={otherSerial} onChange={(e) => setOtherSerial(e.target.value)} placeholder="Serial (optional)" aria-label="Serial of the item not ours"
            className="h-9 w-40 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-brand" />
          <Button size="sm" icon="plus" disabled={!otherName.trim()} onClick={addOther}>Add</Button>
        </div>
      </div>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <li key={v.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground">
              {v.equipmentName}{v.serialNo ? <span className="font-mono text-muted-foreground">{v.serialNo}</span> : null}
              {!v.ours && <Badge tone="warning">not ours</Badge>}
              <button type="button" aria-label={`Remove ${v.equipmentName}`} className="text-muted-foreground hover:text-danger" onClick={() => onChange(value.filter((x) => x.key !== v.key))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
