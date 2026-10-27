'use client';

import { useState } from 'react';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { quickAddCustomerAction, searchCustomersWithAddressAction, type CustomerPick } from '@/app/actions/search-options';

const field = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm';

/**
 * Any customer, or a new one in three fields (27 Oct 2026, Vcare) - for the
 * survey visit and the installation challan, which are both often for
 * somebody not on file yet. Search by name, phone or code.
 */
export function CustomerPicker({ id, value, onChange }: {
  id: string;
  value: CustomerPick | null;
  onChange: (c: CustomerPick | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (adding) {
    return (
      <div className="grid gap-2 rounded-lg border border-border p-2.5">
        <p className="text-xs font-medium">New customer</p>
        {error && <p className="text-xs text-on-tint-danger" role="alert">{error}</p>}
        <input aria-label="Customer name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={field} autoFocus />
        <input aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (10 digits)" inputMode="tel" className={field} />
        <input aria-label="Address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" className={field} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="h-8 rounded-lg border border-border px-3 text-xs">Cancel</button>
          <button type="button" disabled={busy} className="h-8 rounded-lg bg-brand px-3 text-xs font-medium text-brand-fg disabled:opacity-50"
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await quickAddCustomerAction({ name, phone, address: address || null });
              setBusy(false);
              if (r.error || !r.customer) { setError(r.error ?? 'Could not add the customer.'); return; }
              onChange(r.customer); setAdding(false); setName(''); setPhone(''); setAddress('');
            }}>
            {busy ? 'Adding…' : 'Add customer'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <SearchSelect id={id} label="Customer" value={value} onChange={(o: SearchOption | null) => onChange(o as CustomerPick | null)}
        search={searchCustomersWithAddressAction} placeholder="Customer name, phone or code…" />
      {!value && (
        <button type="button" onClick={() => setAdding(true)} className="justify-self-start text-xs font-medium text-brand hover:underline">
          + New customer - not on file yet
        </button>
      )}
    </div>
  );
}
