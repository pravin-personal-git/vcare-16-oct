'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { ReceiveGoodsModal } from '../GoodsReceiptClient';
import { addReceiptItems } from '../actions';

/**
 * "Add items" on a posted, unbilled receipt (29 Oct 2026): the receive form's
 * items part, scanning included. The server refuses a billed receipt too.
 */
export function AddItems({ grnId, grnNo, partyId }: { grnId: string; grnNo: string; partyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <>
      <Button size="sm" icon="plus" onClick={() => { setFlash(null); setOpen(true); }}>Add items</Button>
      {flash && <p className="mt-1 text-xs text-success">{flash}</p>}
      {open && (
        <WithFormOptions need={['stockProducts']} onClose={() => setOpen(false)}>
          {(o) => (
            <ReceiveGoodsModal
              orders={[]}
              suppliers={[]}
              products={o.stockProducts}
              initialScan={null}
              initialReceive={null}
              addTo={{ grnNo, partyId }}
              onClose={() => setOpen(false)}
              onSubmit={async (input) => {
                const res = await addReceiptItems(grnId, input.lines);
                if (res.error) return res;
                setOpen(false);
                setFlash(res.message ?? 'Added.');
                router.refresh();
                return res;
              }}
            />
          )}
        </WithFormOptions>
      )}
    </>
  );
}
