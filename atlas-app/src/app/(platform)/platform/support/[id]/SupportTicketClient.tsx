'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { FilePicker, Thread, uploadFiles, type ThreadComment } from '@/components/helpdesk/Thread';
import type { TicketStatus } from '@/server/helpdesk';
import { replyAction, statusAction } from '../actions';

interface Ticket {
  id: string; ticketNo: string; subject: string; description: string; status: TicketStatus; priority: string;
  organizationId: string; businessName: string; branchName: string; raisedByName: string; createdAt: string;
  context: Record<string, string>; comments: ThreadComment[];
}

const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', in_progress: 'Working', resolved: 'Solved', closed: 'Closed' };
const NEXT: Record<TicketStatus, TicketStatus[]> = { open: ['in_progress', 'resolved', 'closed'], in_progress: ['resolved', 'closed'], resolved: ['closed', 'open'], closed: ['open'] };
const CONTEXT_LABEL: Record<string, string> = { page: 'Page they came from', roles: 'Their roles', branch: 'Branch', app: 'App version', browser: 'Browser', screen: 'Screen' };

export function SupportTicketClient({ ticket, canOpenBusiness }: { ticket: Ticket; canOpenBusiness: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const send = () => start(async () => {
    setError(null);
    const r = await replyAction(ticket.id, body || (files.length ? 'Screenshot' : ''), internal);
    if ('error' in r) { setError(r.error); return; }
    const failed = await uploadFiles('/api/platform/support/files', ticket.id, r.commentId, files);
    if (failed) setError(`Reply sent, but: ${failed}`);
    setBody(''); setFiles([]);
    router.refresh();
  });
  const move = (s: TicketStatus) => start(async () => {
    const r = await statusAction(ticket.id, s);
    if ('error' in r) setError(r.error); else router.refresh();
  });

  return (
    <div className="space-y-4">
      <Link href="/platform/support" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><Icon name="arrow-left" className="h-4 w-4" />Support</Link>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 font-bold">{ticket.subject}</h1>
          <p className="text-sm text-muted-foreground">{ticket.businessName} · {ticket.branchName} · {ticket.raisedByName} · {ticket.ticketNo}</p>
        </div>
        <Badge tone={ticket.status === 'open' ? 'info' : ticket.status === 'in_progress' ? 'warning' : ticket.status === 'resolved' ? 'success' : 'neutral'}>{STATUS_LABEL[ticket.status]}</Badge>
        {ticket.priority !== 'normal' && <Badge tone="warning">{ticket.priority}</Badge>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="space-y-3 rounded-2xl bg-card p-4" aria-label="Conversation">
          <p className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-sm">{ticket.description}</p>
          <Thread comments={ticket.comments} side="support" />

          <div className={`space-y-2 rounded-xl border p-3 ${internal ? 'border-dashed border-warning bg-warning/5' : 'border-border'}`}>
            <label htmlFor="sp-reply" className="sr-only">{internal ? 'Write an internal note' : 'Reply to the business'}</label>
            <textarea id="sp-reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={internal ? 'Internal note - the business will not see this' : `Reply to ${ticket.raisedByName}…`}
              className="w-full resize-y rounded-lg bg-transparent text-sm outline-none" />
            <FilePicker id="sp-files" files={files} onChange={setFiles} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4 accent-[var(--color-warning)]" />
                Internal note
              </label>
              <button type="button" onClick={send} disabled={busy || (!body.trim() && !files.length)}
                className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-brand-fg transition hover:bg-brand-hover disabled:opacity-50">
                <Icon name="send" className="h-4 w-4" />{busy ? 'Sending…' : internal ? 'Save note' : 'Send reply'}
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-3">
          <section className="rounded-2xl bg-card p-4" aria-label="Status">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Move to</p>
            <div className="flex flex-wrap gap-1.5">
              {NEXT[ticket.status].map((s) => (
                <button key={s} type="button" disabled={busy} onClick={() => move(s)} className="h-8 rounded-full bg-muted px-3 text-xs font-semibold transition hover:bg-border disabled:opacity-50">{STATUS_LABEL[s]}</button>
              ))}
            </div>
          </section>
          <section className="rounded-2xl bg-card p-4" aria-label="What they were looking at">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What they were looking at</p>
            {Object.keys(ticket.context).length === 0 ? <p className="text-sm text-muted-foreground">Nothing captured.</p> : (
              <dl className="space-y-1.5 text-sm">
                {Object.entries(ticket.context).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{CONTEXT_LABEL[k] ?? k}</dt><dd className="break-words">{v}</dd></div>
                ))}
              </dl>
            )}
          </section>
          {canOpenBusiness && (
            <Link href={`/platform/tenants/${ticket.organizationId}`} className="flex items-center gap-2 rounded-2xl bg-card p-4 text-sm font-semibold transition hover:bg-muted">
              <Icon name="building" className="h-4 w-4" />Open {ticket.businessName}<Icon name="arrow-right" className="ms-auto h-4 w-4" />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
