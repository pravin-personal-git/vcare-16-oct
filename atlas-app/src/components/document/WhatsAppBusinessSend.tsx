'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { sendDocumentWhatsAppAction } from '@/app/actions/document-send';
import type { SendDocType, SendRow, WhatsAppApiState } from '@/server/document-send';

const STATUS: Record<string, { label: string; tone: string }> = {
  sent: { label: 'Sent', tone: 'text-muted-foreground' },
  delivered: { label: 'Delivered', tone: 'text-info' },
  read: { label: 'Read', tone: 'text-success' },
  failed: { label: 'Failed', tone: 'text-danger' },
};

const at = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * "Send PDF from business WhatsApp" and what became of each send (A3, 12 Oct
 * 2026). Shown only where the branch has started setting up WhatsApp
 * Business; until it is complete, says what is missing. The ActionBar's
 * "Open in my WhatsApp" (A1) stays the everyday way meanwhile.
 */
export function WhatsAppBusinessSend({ type, id, state, configured, sends }: {
  type: SendDocType;
  id: string;
  state: WhatsAppApiState;
  /** The branch has a WhatsApp Business channel at all - otherwise nothing is shown. */
  configured: boolean;
  sends: SendRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!configured && sends.length === 0) return null;

  const send = () => start(async () => {
    setError(null);
    const r = await sendDocumentWhatsAppAction(type, id);
    if (r.error) setError(r.error); else router.refresh();
  });

  return (
    <section className="no-print mb-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="whatsapp" className="h-4 w-4 text-success" />
        <span className="me-auto text-sm font-medium">WhatsApp Business</span>
        <Button variant="wa" icon="send" disabled={!state.ready || pending} title={state.reason ?? undefined} onClick={send}>
          {pending ? 'Sending…' : 'Send PDF from business WhatsApp'}
        </Button>
      </div>
      {!state.ready && state.reason && <p className="mt-2 text-xs text-muted-foreground">{state.reason}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">{error}</p>}
      {sends.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs">
          {sends.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2">
              <span className={`font-semibold ${STATUS[s.status]?.tone ?? ''}`}>{STATUS[s.status]?.label ?? s.status}</span>
              <span className="text-muted-foreground">{at(s.readAt ?? s.deliveredAt ?? s.sentAt)}</span>
              <span className="text-muted-foreground">to {s.toPhone}{s.by ? ` · by ${s.by}` : ''}</span>
              {s.error && <span className="text-danger">{s.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
