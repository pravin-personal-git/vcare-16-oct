'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { creditReturn, markReceived, voidReturn } from '../actions';

/** The three things you can do to a return, and nothing you cannot. */
export function ReturnActions({
  id, returnNo, lifecycle, hasIssuedCredit, canEdit, canCredit,
}: {
  id: string;
  returnNo: string;
  lifecycle: string;
  hasIssuedCredit: boolean;
  canEdit: boolean;
  canCredit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      setVoiding(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && (
        <span className="max-w-md text-xs text-danger">{error}</span>
      )}

      {lifecycle === 'draft' && canEdit && (
        <Button
          variant="primary" icon="check" loading={pending}
          onClick={() => run(() => markReceived(id))}
        >
          Goods received
        </Button>
      )}

      {lifecycle === 'received' && !hasIssuedCredit && canCredit && (
        <Button
          variant="primary" icon="receipt" loading={pending}
          onClick={() => run(() => creditReturn(id))}
        >
          Issue credit note
        </Button>
      )}

      {lifecycle !== 'cancelled' && canEdit && (
        <Button icon="x" onClick={() => setVoiding(true)}>Cancel</Button>
      )}

      {voiding && (
        <Modal
          open
          title={`Cancel ${returnNo}`}
          icon="x"
          tone="danger"
          size="sm"
          onClose={() => setVoiding(false)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button onClick={() => setVoiding(false)}>Keep it</Button>
              <Button
                variant="danger" icon="x"
                disabled={!reason.trim() || pending || hasIssuedCredit} loading={pending}
                onClick={() => run(() => voidReturn(id, reason))}
              >
                Cancel return
              </Button>
            </div>
          }
        >
          {hasIssuedCredit ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-danger">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A credit note has been issued against this return. Cancel that first - the
                goods and the money have to be withdrawn together.
              </span>
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Any stock this put back is taken out again with a reversing movement. The
                record stays, and the invoice becomes returnable once more.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why is this being cancelled?"
                className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
              />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
