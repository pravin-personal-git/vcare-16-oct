'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { linkReceiptLine } from '../actions';

/**
 * A posted receipt's line that never reached stock (G1, 12 Oct 2026): say so
 * in red, and let somebody with purchase rights link it to its product - which
 * puts the stock in now.
 */
export function LinkLine({ grnItemId, canEdit }: { grnItemId: string; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);

  return (
    <div className="mt-1 rounded-md border border-danger/30 bg-danger/[0.06] px-2 py-1.5 text-xs">
      <p className="font-semibold text-danger">Added no stock - this line is not linked to a product.</p>
      {canEdit && !open && !note?.text && (
        <button type="button" className="mt-0.5 font-semibold text-brand hover:underline" onClick={() => setOpen(true)}>
          Link to a product and put the stock in
        </button>
      )}
      {open && (
        <WithFormOptions need={['stockProducts']} onClose={() => setOpen(false)}>
          {(o) => (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <select
                aria-label="Product"
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Choose the product…</option>
                {o.stockProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </select>
              <Button
                size="sm" variant="primary" disabled={!pick} loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await linkReceiptLine(grnItemId, pick);
                  setBusy(false);
                  setNote(r.error ? { error: true, text: r.error } : { error: false, text: r.message ?? 'Linked.' });
                  if (!r.error) { setOpen(false); router.refresh(); }
                }}
              >
                Link and stock in
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          )}
        </WithFormOptions>
      )}
      {note && <p className={`mt-1 ${note.error ? 'text-danger' : 'text-success'}`}>{note.text}</p>}
    </div>
  );
}
