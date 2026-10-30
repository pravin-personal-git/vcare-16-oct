'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';

/**
 * A helpdesk conversation and the screenshot picker, shared by the business's
 * Helpdesk and the platform portal's Support (30 Oct 2026).
 */
export interface ThreadComment {
  id: string;
  kind: string;
  body: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  authorName: string | null;
  createdAt: string;
  fromSupport: boolean;
  internal: boolean;
  files: { id: string; fileName: string; mimeType: string; url: string | null }[];
}

const words = (s: string | null) => s?.replace('_', ' ') ?? '';

export function Thread({ comments, side }: { comments: ThreadComment[]; side: 'business' | 'support' }) {
  return (
    <ol className="space-y-2.5">
      {comments.map((c) => {
        const when = new Date(c.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
        if (c.kind !== 'note') {
          return (
            <li key={c.id} className="text-center text-xs text-muted-foreground">
              {c.fromSupport && side === 'business' ? 'Software support' : c.authorName ?? 'Someone'}
              {c.kind === 'status_change' ? <> moved it from <strong>{words(c.statusFrom)}</strong> to <strong>{words(c.statusTo)}</strong></> : <> {c.body}</>}
              {' · '}{when}
            </li>
          );
        }
        const mine = side === 'support' ? c.fromSupport : !c.fromSupport;
        return (
          <li key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${c.internal ? 'border border-dashed border-warning bg-warning/10' : mine ? 'bg-brand/10' : 'bg-muted'}`}>
              <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{c.authorName ?? 'Someone'}</span>
                {c.fromSupport && <Badge tone="navy">Software support</Badge>}
                {c.internal && <Badge tone="warning" icon="lock">Internal - business cannot see</Badge>}
                <span>{when}</span>
              </p>
              {c.body && <p className="whitespace-pre-wrap">{c.body}</p>}
              {c.files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {c.files.map((f) => (
                    <li key={f.id}>
                      {f.url && f.mimeType.startsWith('image/') ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not an optimisable asset */}
                          <img src={f.url} alt={f.fileName} className="h-24 w-36 object-cover" />
                        </a>
                      ) : (
                        <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                          <Icon name="paperclip" className="h-3.5 w-3.5" />{f.fileName}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Choose files, or paste a screenshot (Ctrl+V) anywhere on the page while it is open. */
export function FilePicker({ files, onChange, id }: { files: File[]; onChange: (f: File[]) => void; id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(files);
  latest.current = files;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (pasted.length) onChange([...latest.current, ...pasted.map((f, i) => new File([f], f.name === 'image.png' ? `screenshot-${Date.now()}-${i}.png` : f.name, { type: f.type }))]);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onChange]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} id={id} type="file" multiple accept="image/*,application/pdf" className="sr-only"
        onChange={(e) => { onChange([...files, ...(e.target.files ?? [])]); e.target.value = ''; }} />
      <label htmlFor={id} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold transition hover:bg-border">
        <Icon name="image" className="h-3.5 w-3.5" />Screenshot / file
      </label>
      <span className="text-xs text-muted-foreground">ya Ctrl+V se paste karein</span>
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs">
          {f.name}
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-brand/20">
            <Icon name="x" className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Upload chosen files onto one comment. Returns the first error, if any. */
export async function uploadFiles(url: string, ticketId: string, commentId: string, files: File[]): Promise<string | null> {
  for (const file of files) {
    const form = new FormData();
    form.set('ticketId', ticketId);
    form.set('commentId', commentId);
    form.set('file', file);
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Could not upload ${file.name}.`;
  }
  return null;
}
