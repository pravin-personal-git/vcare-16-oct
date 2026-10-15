'use client';

import { useEffect, useRef, useState } from 'react';
import { type AttachmentView } from './Attachments';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import { Badge } from './Layout';
import { Modal } from './Modal';
import { ATTACHMENT_TAGS, DEFAULT_TAG, needsChecklist, REQUIRED_DOCS, type RequiredRule } from '@/lib/attachment-tags';
import { readKindForTag } from '@/lib/scan/doc-read';
import { whatsappLink } from '@/lib/revenue';
import { safeDocNo } from '@/lib/wa-message';
import {
  attachmentNeedsAction, readAttachmentAction, removeAttachmentAction, setAttachmentTagAction,
  setAttachmentVisibleAction, shareAttachmentAction,
} from '@/app/actions/attachments';

/**
 * ATTACHMENTS THAT DO SOMETHING (11 Oct 2026, ops-pages demo tab 4).
 *
 * Every file has a tag (picked before adding, changeable after). Above the
 * list, "This document needs" ticks off what Settings › Required documents
 * asks for. Each file can be previewed, sent on WhatsApp (a week-long link),
 * re-tagged, downloaded, read by the AI reader (PO / payment proof), shown to
 * the customer, replaced by a newer version (old kept) or removed with a
 * reason (kept too - nothing is hard-deleted).
 *
 * Uploads go through `POST /api/attachments` rather than a server action,
 * because server actions cap the body at 1 MB and a scanned purchase order is
 * routinely bigger than that. One file at a time, on purpose: ten parallel
 * uploads on connection_limit=1 time out halfway.
 */
type PanelDocType = 'quotation' | 'sales_order' | 'invoice' | 'complaint' | 'installation_challan' | 'receipt';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.csv,application/pdf,image/jpeg,image/png,image/webp';

const fmtWhen = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function AttachmentPanel({
  docType,
  docId,
  initial,
  readOnly = false,
  phone,
  docLabel,
  title = 'Attachments',
}: {
  docType: PanelDocType;
  docId: string;
  initial: AttachmentView[];
  readOnly?: boolean;
  /** Customer's phone, for Send on WhatsApp. Without it WhatsApp opens to pick a chat. */
  phone?: string | null;
  /** e.g. "Sales order SO-BR01-2026-0012" - goes in the WhatsApp message. */
  docLabel?: string;
  title?: string;
}) {
  const [files, setFiles] = useState<AttachmentView[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<RequiredRule[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [newTag, setNewTag] = useState<string>(DEFAULT_TAG[docType] ?? 'Other');
  const [tagMenu, setTagMenu] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AttachmentView | null>(null);
  const [reason, setReason] = useState('');
  const [dragging, setDragging] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    attachmentNeedsAction(docType, docId)
      .then((r) => { if (live) { setRules(r.rules); setAiOn(r.aiOn); } })
      .catch(() => { /* the checklist is a help, not a gate - the list still works without it */ });
    return () => { live = false; };
  }, [docType, docId]);

  const needs = needsChecklist(rules, docType, files.map((f) => f.tag ?? null), Number.POSITIVE_INFINITY);

  const upload = async (chosen: File[], replaces?: string) => {
    setError(null);
    const failures: string[] = [];
    for (const file of chosen) {
      const body = new FormData();
      body.set('docType', docType);
      body.set('docId', docId);
      body.set('file', file);
      if (replaces) body.set('replaces', replaces);
      else body.set('tag', newTag);
      setBusy('upload');
      try {
        const res = await fetch('/api/attachments', { method: 'POST', body });
        const json = await res.json();
        if (!res.ok) { failures.push(`${file.name}: ${json.error ?? res.statusText}`); continue; }
        setFiles((prev) => {
          const old = replaces ? prev.find((f) => f.id === replaces) : undefined;
          const row = { ...(json as AttachmentView), olderVersions: old ? (old.olderVersions ?? 0) + 1 : 0 };
          return [row, ...prev.filter((f) => f.id !== replaces)];
        });
      } catch {
        failures.push(`${file.name}: the upload did not complete.`);
      } finally {
        setBusy(null);
      }
    }
    if (failures.length) setError(failures.join('\n'));
  };

  const take = (list: FileList | null, el: HTMLInputElement | null, replaces?: string) => {
    if (list && list.length) void upload(Array.from(list), replaces);
    if (el) el.value = '';
  };

  const patch = (id: string, p: Partial<AttachmentView>) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const run = async (id: string, key: string, fn: () => Promise<{ error?: string }>, undo?: () => void) => {
    setError(null);
    setBusy(`${key}:${id}`);
    const r = await fn().catch(() => ({ error: 'That did not go through. Try again.' }));
    setBusy(null);
    if (r.error) { undo?.(); setError(r.error); }
    return r;
  };

  const retag = (f: AttachmentView, tag: string) => {
    setTagMenu(null);
    const before = f.tag ?? null;
    patch(f.id, { tag, extracted: f.extracted });
    void run(f.id, 'tag', () => setAttachmentTagAction(f.id, tag), () => patch(f.id, { tag: before }));
  };

  const toggleCustomer = (f: AttachmentView) => {
    const next = !f.visibleToCustomer;
    patch(f.id, { visibleToCustomer: next });
    void run(f.id, 'cust', () => setAttachmentVisibleAction(f.id, next), () => patch(f.id, { visibleToCustomer: !next }));
  };

  const sendWhatsApp = async (f: AttachmentView) => {
    // Opened now, filled in after the link comes back - a window opened after an await is blocked as a pop-up.
    const w = window.open('', '_blank');
    const r = await run(f.id, 'wa', () => shareAttachmentAction(f.id)) as { url?: string; days?: number };
    if (!r.url) { w?.close(); return; }
    const text = `${docLabel ? `${safeDocNo(docLabel)} - ` : ''}${f.tag && f.tag !== 'Other' ? `${f.tag.toLowerCase()}: ` : ''}${f.fileName}\n${r.url}\n(link works for ${r.days ?? 7} days)`;
    const link = whatsappLink(phone, text);
    if (w) w.location.href = link; else window.location.href = link;
  };

  const readIt = async (f: AttachmentView) => {
    const r = await run(f.id, 'read', () => readAttachmentAction(f.id)) as { summary?: string; match?: boolean | null };
    if (r.summary) patch(f.id, { extracted: { summary: r.summary, match: r.match ?? null } });
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const f = removing;
    const r = await run(f.id, 'remove', () => removeAttachmentAction(f.id, reason));
    if (!r.error) { setFiles((prev) => prev.filter((x) => x.id !== f.id)); setRemoving(null); setReason(''); }
  };

  const iconBtn = (key: string, icon: IconName, label: string, onClick: () => void, f: AttachmentView, tone = '') => (
    <button
      type="button"
      title={label}
      aria-label={`${label} - ${f.fileName}`}
      disabled={busy === `${key}:${f.id}`}
      onClick={onClick}
      className={`rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50 ${tone}`}
    >
      <Icon name={busy === `${key}:${f.id}` ? 'refresh' : icon} className={`h-3.5 w-3.5 ${busy === `${key}:${f.id}` ? 'animate-spin' : ''}`} />
    </button>
  );

  return (
    <section className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Icon name="paperclip" className="h-4 w-4 text-brand" />
        <h3 className="me-auto text-sm font-semibold">{title} ({files.length})</h3>
        {!readOnly && (
          <>
            <label className="sr-only" htmlFor={`tag-${docId}`}>Tag for new files</label>
            <select id={`tag-${docId}`} value={newTag} onChange={(e) => setNewTag(e.target.value)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs">
              {ATTACHMENT_TAGS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <Button size="sm" variant="tint" icon="camera" className="sm:hidden" onClick={() => cameraRef.current?.click()}>Photo</Button>
            <Button size="sm" variant="tint" icon="plus" loading={busy === 'upload'} onClick={() => pickRef.current?.click()}>Add</Button>
          </>
        )}
      </div>
      <input ref={pickRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => take(e.target.files, e.target)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => take(e.target.files, e.target)} />
      <input ref={replaceRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => take(e.target.files, e.target, replacing.current ?? undefined)} />

      <div className="p-4">
        {needs.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-micro font-semibold uppercase text-muted-foreground">This document needs</span>
            {needs.map((n) => (
              <Badge key={`${n.doc}-${n.tag}`} tone={n.ok ? 'success' : n.mode === 'block' ? 'danger' : 'warning'}
                title={n.ok ? 'Attached' : n.mode === 'block' ? `Needed before "${REQUIRED_DOCS[n.doc].step}"` : 'Missing - a reminder, nothing is stopped'}>
                <Icon name={n.ok ? 'check' : 'alert-circle'} className="h-3 w-3" />
                {n.tag === 'Signed challan' ? 'Signed delivery challan' : n.tag}
              </Badge>
            ))}
          </div>
        )}

        {files.length === 0 ? (
          readOnly ? (
            <p className="rounded-sm border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No files attached.</p>
          ) : (
            <button
              type="button"
              onClick={() => pickRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(Array.from(e.dataTransfer.files)); }}
              className={`w-full rounded-sm border border-dashed px-3 py-5 text-center transition ${dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/50 hover:bg-muted/50'}`}
            >
              <Icon name="upload" className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-1.5 text-xs font-medium">Drop files here, or click to choose</p>
              <p className="mt-0.5 text-xs text-muted-foreground">PDF, image, Excel, Word or CSV - up to 10 MB each · tagged &ldquo;{newTag}&rdquo;</p>
            </button>
          )
        ) : (
          <div className="space-y-2">
            {files.map((f) => {
              const readable = !!readKindForTag(f.tag) && (f.mimeType === 'application/pdf' || f.mimeType.startsWith('image/'));
              return (
                <div key={f.id} className="btn-lift relative flex flex-wrap items-center gap-3 rounded-sm border border-border p-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                    <Icon name={f.mimeType === 'application/pdf' ? 'file-text' : f.mimeType.startsWith('image/') ? 'camera' : 'paperclip'} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {f.url
                      ? <a href={f.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-brand hover:underline">{f.fileName}</a>
                      : <p title="This file is no longer in storage." className="truncate text-sm font-medium text-muted-foreground line-through">{f.fileName}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {f.tag && <Badge tone="info">{f.tag}</Badge>}
                      <span>{[f.uploadedByName, fmtWhen(f.uploadedAt)].filter(Boolean).join(' · ')}</span>
                      {!!f.olderVersions && <span title="Earlier versions are kept">v{f.olderVersions + 1}</span>}
                      {f.extracted?.summary && (
                        <span className={`inline-flex items-center gap-1 ${f.extracted.match === false ? 'text-danger' : 'text-success'}`}>
                          <Icon name="sparkles" className="h-3 w-3" />Read: {f.extracted.summary}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5">
                    {f.url && iconBtn('view', 'eye', 'Preview', () => window.open(f.url!, '_blank', 'noopener'), f)}
                    {iconBtn('wa', 'whatsapp', 'Send on WhatsApp', () => void sendWhatsApp(f), f)}
                    {!readOnly && iconBtn('tag', 'tag', 'Change tag', () => setTagMenu(tagMenu === f.id ? null : f.id), f)}
                    {f.url && (
                      <a href={f.url} download={f.fileName} title="Download" aria-label={`Download - ${f.fileName}`}
                        className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                        <Icon name="download" className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {!readOnly && readable && aiOn && iconBtn('read', 'sparkles', f.extracted ? 'Read again' : 'Read it (AI)', () => void readIt(f), f, 'text-brand')}
                    {!readOnly && iconBtn('replace', 'upload', 'Replace with a new version (old kept)', () => { replacing.current = f.id; replaceRef.current?.click(); }, f)}
                    {!readOnly && iconBtn('remove', 'trash', 'Remove', () => { setRemoving(f); setReason(''); }, f, 'hover:!bg-danger/10 hover:!text-danger')}
                    <button
                      type="button"
                      disabled={readOnly || busy === `cust:${f.id}`}
                      onClick={() => toggleCustomer(f)}
                      title={f.visibleToCustomer ? 'The customer sees this in their portal. Click to make it internal.' : 'Only your team sees this. Click to show it in the customer portal.'}
                      className={`ms-1 rounded-full px-2 py-1 text-cap font-semibold ${f.visibleToCustomer ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                    >
                      {f.visibleToCustomer ? 'Customer sees it' : 'Internal'}
                    </button>
                  </div>
                  {tagMenu === f.id && (
                    <div role="menu" className="absolute end-2 top-full z-20 mt-1 grid w-48 gap-0.5 rounded-md border border-border bg-card p-1 shadow-raised">
                      {ATTACHMENT_TAGS.map((t) => (
                        <button key={t} type="button" role="menuitem" onClick={() => retag(f, t)}
                          className={`flex items-center justify-between rounded-sm px-2.5 py-1.5 text-start text-sm hover:bg-muted ${f.tag === t ? 'font-semibold text-brand' : ''}`}>
                          {t}{f.tag === t && <Icon name="check" className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 flex items-start gap-2 whitespace-pre-line rounded-sm bg-danger/10 px-3 py-2.5 text-xs text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </div>

      {removing && (
        <Modal title="Remove this file?" subtitle={removing.fileName} icon="trash" size="sm" onClose={() => setRemoving(null)}
          footer={(
            <>
              <Button onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="danger" icon="trash" disabled={!reason.trim()} loading={busy === `remove:${removing.id}`} onClick={() => void confirmRemove()}>Remove</Button>
            </>
          )}>
          <label className="block text-sm font-medium" htmlFor="remove-reason">Why is it being removed?</label>
          <textarea id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
            placeholder="e.g. Wrong customer's PO uploaded"
            className="mt-1.5 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm" />
          <p className="mt-2 text-xs text-muted-foreground">It disappears from this document. The file and your reason are kept on record.</p>
        </Modal>
      )}
    </section>
  );
}
