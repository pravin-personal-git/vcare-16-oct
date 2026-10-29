'use client';

import { CustomFieldsPanel } from '@/components/custom-fields/CustomFieldsPanel';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import type { LeadDetail } from '@/server/lead-detail';
import { initials, whatsappLink } from '@/lib/revenue';
import {
  loadLeadDetail, logActivity, addNote, deleteNote,
  updateLeadField, convertToCustomer,
} from './detail-actions';
import { DocPhotos } from '@/components/scan/DocPhotos';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { istDate } from '@/lib/date-ranges';
import { ask } from '@/components/ui/ask';
import { buttonClass } from '@/components/ui/button-class';
import { Icon } from '@/components/ui/Icon';

type Tab = 'statistics' | 'timeline' | 'meetings' | 'comments' | 'quotations' | 'files';
const TABS: { key: Tab; label: string }[] = [
  { key: 'statistics', label: 'Statistics' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'comments', label: 'Comments' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'files', label: 'Files' },
];

const CHANNELS = ['all', 'whatsapp', 'call', 'quotation', 'meeting', 'email'] as const;

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '-';

const fmtDay = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

interface Props {
  leadId: string;
  stages: { id: string; name: string; isGroupHeader: boolean }[];
  dealStages: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  onClose: () => void;
  /** Extra-field editing; the server checks leads.edit either way. */
  canEditFields?: boolean;
}

export function LeadDrawer({ leadId, stages, dealStages, users, onClose, canEditFields = true }: Props) {
  const [tab, setTab] = useState<Tab>('statistics');
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('all');
  const [noteText, setNoteText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  // useCallback so the effect below can depend on it honestly. Without it,
  // refresh is a new function every render, the effect would fire on every
  // render, and the usual workaround - silencing the lint rule - leaves a
  // closure that can go stale the moment anything else is captured here.
  const refresh = useCallback(
    () => loadLeadDetail(leadId).then((d) => { setLead(d); setLoading(false); }),
    [leadId],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  const act = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) await ask.error(r.error);
      else if (r.message) await ask.tell(r.message);
      await refresh();
    });

  if (loading || !lead) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="rounded-lg bg-card px-6 py-4 text-sm shadow-overlay">Loading…</div>
      </div>
    );
  }

  const activities = channel === 'all'
    ? lead.activities
    : lead.activities.filter((a) => a.channel === channel);

  const meetings = lead.activities.filter((a) => a.channel === 'meeting');

  const stat = (label: string, value: string, sub: string) => (
    <div className="border-e border-border px-4 py-3 last:border-e-0">
      <p className="text-micro uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );

  // The shared button look (13 Oct 2026 audit): this bar had grown its own.
  const OUTLINE = 'outline' as const;
  const actionBtn = (label: string, variant: 'outline' | 'primary' | 'success', onClick: () => void, disabled = false) => (
    <button key={label} type="button" onClick={onClick} disabled={disabled || pending}
      className={`${buttonClass(variant, 'sm')} h-9 disabled:opacity-40`}>
      {label}
    </button>
  );

  return (
    <DialogFrame label="Lead" onClose={onClose} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-2 sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-5xl animate-slide-up flex-col overflow-hidden rounded-lg bg-card shadow-overlay">

        {/* header */}
        <div className="bg-navy px-5 py-3.5 text-navy-fg">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-fg">
              {initials(lead.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold">{lead.displayName}</h2>
                <span className="rounded bg-white/20 px-2 py-0.5 font-mono text-xs">{lead.leadCode}</span>
                {lead.stageName && (
                  <span className="rounded bg-white/20 px-2 py-0.5 text-xs">{lead.stageName}</span>
                )}
                {lead.convertedCustomerId && (
                  <span className="rounded-full bg-success px-2 py-0.5 text-xs font-semibold text-brand-fg">Converted</span>
                )}
              </div>
              <p className="truncate text-xs opacity-90">
                {lead.mobile}{lead.location && ` · ${lead.location}`}
                {lead.businessName && ` · ${lead.businessName}`}
              </p>
            </div>
            <div className="hidden text-end text-xs opacity-90 sm:block">
              <p className="text-micro uppercase tracking-wide">Lead since</p>
              <p className="font-semibold">{fmtDay(lead.sinceDate)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25">
              <span className="text-lg leading-none">×</span>
            </button>
          </div>

          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`whitespace-nowrap rounded-t px-3 py-1.5 text-xs font-medium transition ${
                  tab === t.key ? 'bg-card text-brand' : 'text-navy-fg/75 hover:bg-white/10'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* stat strip */}
        <div className="grid grid-cols-2 border-b border-border bg-muted/40 sm:grid-cols-4">
          {stat('Potential value', formatCurrency(lead.potentialPaise), 'Estimated deal size')}
          {stat('Communications', String(lead.activities.length), 'All channels combined')}
          {stat('Meetings', String(meetings.length), `${meetings.filter((m) => m.outcome === 'done').length} done`)}
          {stat('Lead age', `${lead.ageDays} days`, 'Since creation')}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'statistics' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded border border-border p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead info</h3>
                  <dl className="space-y-2 text-sm">
                    {[
                      ['Source', lead.sourceName ?? '-'],
                      ['Mobile', lead.mobile],
                      ['Email', lead.email ?? '-'],
                      ['Requirement', lead.requirement ?? '-'],
                      ['Last talk', fmtDay(lead.lastTalkAt)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <dt className="w-28 shrink-0 text-xs text-muted-foreground">{k}</dt>
                        <dd className="min-w-0 flex-1 break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted-foreground">Pipeline stage</span>
                      <select value={lead.stageId ?? ''} disabled={pending}
                        onChange={(e) => act(() => updateLeadField(lead.id, { stageId: e.target.value }))}
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
                        <option value="">-</option>
                        {stages.filter((s) => !s.isGroupHeader).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted-foreground">Deal stage</span>
                      <select value={lead.dealStageId ?? ''} disabled={pending}
                        onChange={(e) => act(() => updateLeadField(lead.id, { dealStageId: e.target.value }))}
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
                        <option value="">-</option>
                        {dealStages.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted-foreground">Assigned to</span>
                      <select value={lead.assignedToUserId ?? ''} disabled={pending}
                        onChange={(e) => act(() => updateLeadField(lead.id, { assignedToUserId: e.target.value }))}
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
                        <option value="">Unassigned</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted-foreground">Next follow-up</span>
                      <input type="date" disabled={pending}
                        defaultValue={lead.nextActionAt ? istDate(new Date(lead.nextActionAt)) : ''}
                        onChange={(e) => act(() => updateLeadField(lead.id, { nextActionAt: e.target.value }))}
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
                    </label>
                  </div>

                  {lead.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1">
                      {lead.tags.map((t) => (
                        <span key={t} className="rounded bg-muted px-2 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <CustomFieldsPanel entity="lead" id={lead.id} canEdit={canEditFields} />
                <div className="rounded border border-border p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Internal note about the lead
                  </h3>
                  <div className="flex gap-2">
                    <input value={noteText} onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Only your team sees this"
                      className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand" />
                    <button disabled={pending || !noteText.trim()}
                      onClick={() => act(async () => { const r = await addNote(lead.id, noteText, 'note'); setNoteText(''); return r; })}
                      className="rounded bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg disabled:opacity-50">
                      + Add
                    </button>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {lead.notes.map((n) => (
                      <li key={n.id} className="rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                        <p>{n.body}</p>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{n.author ?? 'Someone'} · {fmt(n.createdAt)}</span>
                          <button onClick={() => act(() => deleteNote(n.id))} className="text-danger">Delete</button>
                        </div>
                      </li>
                    ))}
                    {lead.notes.length === 0 && (
                      <li className="py-3 text-center text-xs text-muted-foreground">No notes yet.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded border border-border p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {(['whatsapp', 'email', 'call', 'meeting'] as const).map((c) => (
                      <div key={c}>
                        <p className="text-lg font-bold">{lead.channelCounts[c] ?? 0}</p>
                        <p className="text-xs capitalize text-muted-foreground">{c}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'timeline' && (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-1">
                {CHANNELS.map((c) => (
                  <button key={c} onClick={() => setChannel(c)}
                    className={`rounded-full px-3 py-1 text-xs capitalize transition ${
                      channel === c ? 'bg-foreground text-background' : 'border border-border hover:bg-muted'
                    }`}>
                    {c}
                  </button>
                ))}
                <span className="ms-auto text-xs text-muted-foreground">{activities.length} events</span>
              </div>

              <ul className="space-y-2">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3 rounded border border-border p-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs capitalize">
                      {a.channel[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize">
                        {a.channel}{a.outcome && ` - ${a.outcome}`}
                      </p>
                      {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        {fmt(a.occurredAt)}{a.author && ` · by ${a.author}`}
                        {a.durationSec != null && ` · ${a.durationSec}s`}
                      </p>
                    </div>
                    {a.outcome && (
                      <span className={`h-fit rounded px-2 py-0.5 text-xs ${
                        a.outcome === 'connected' || a.outcome === 'done'
                          ? 'bg-success/15 text-on-tint-success' : 'bg-warning/15 text-on-tint-warning'
                      }`}>{a.outcome}</span>
                    )}
                  </li>
                ))}
                {activities.length === 0 && (
                  <li className="py-10 text-center text-sm text-muted-foreground">
                    Nothing logged yet. Use the buttons below.
                  </li>
                )}
              </ul>
            </div>
          )}

          {tab === 'meetings' && (
            <div>
              <ul className="space-y-2">
                {meetings.map((m) => (
                  <li key={m.id} className="rounded border border-border p-3 text-sm">
                    <p className="font-medium">{m.note ?? 'Meeting'}</p>
                    <p className="text-xs text-muted-foreground">{fmt(m.occurredAt)}</p>
                  </li>
                ))}
                {meetings.length === 0 && (
                  <li className="py-10 text-center text-sm text-muted-foreground">No meetings scheduled yet.</li>
                )}
              </ul>
              <button disabled={pending}
                onClick={async () => {
                  const note = await ask.text({
                    title: 'Schedule a meeting',
                    icon: 'calendar',
                    label: 'What is this meeting about?',
                    placeholder: 'e.g. Demo at their office, Friday 11 am',
                    confirmLabel: 'Schedule',
                    required: true,
                  });
                  if (note) act(() => logActivity(lead.id, 'meeting', 'scheduled', note));
                }}
                className={`${buttonClass('success', 'md')} mt-4 w-full disabled:opacity-50`}>
                <Icon name="plus" className="h-4 w-4" />Schedule new meeting
              </button>
            </div>
          )}

          {tab === 'comments' && (
            <div>
              <div className="flex gap-2">
                <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment or follow-up…"
                  className="field-input flex-1" />
                <button disabled={pending || !commentText.trim()}
                  onClick={() => act(async () => { const r = await addNote(lead.id, commentText, 'comment'); setCommentText(''); return r; })}
                  className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
                  Post
                </button>
              </div>
              <ul className="mt-4 space-y-2">
                {lead.comments.map((c) => (
                  <li key={c.id} className="rounded border border-border p-3 text-sm">
                    <p>{c.body}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{c.author ?? 'Someone'} · {fmt(c.createdAt)}</span>
                      <button onClick={() => act(() => deleteNote(c.id))} className="text-danger">Delete</button>
                    </div>
                  </li>
                ))}
                {lead.comments.length === 0 && (
                  <li className="py-10 text-center text-sm text-muted-foreground">No comments yet.</li>
                )}
              </ul>
            </div>
          )}

          {tab === 'files' && <DocPhotos docType="lead" docId={leadId} />}

          {tab === 'quotations' && (
            <div>
              <ul className="space-y-2">
                {lead.quotations.map((q) => (
                  <li key={q.id} className="flex items-center justify-between rounded border border-border p-3 text-sm">
                    <div>
                      <Link href={`/quotation/${q.id}`} className="font-mono font-medium text-brand hover:underline">{q.quotationNo}</Link>
                      <p className="text-xs capitalize text-muted-foreground">
                        {q.status} · {fmtDay(q.quotationDate)}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold">{formatCurrency(q.grandTotalPaise)}</span>
                  </li>
                ))}
                {lead.quotations.length === 0 && (
                  <li className="py-10 text-center text-sm text-muted-foreground">
                    No quotations raised against this lead yet.
                  </li>
                )}
              </ul>
              <Link
                href={`/quotation?lead=${lead.id}`}
                className="mt-4 block w-full rounded-full bg-brand py-2.5 text-center text-sm font-semibold text-brand-fg hover:bg-brand-hover"
              >
                New quotation for this lead
              </Link>
            </div>
          )}
        </div>

        {/* action bar */}
        {/* One colour per role, not one per button (ATLAS-DESIGN.md, 11 Oct 2026). */}
        <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-border bg-card px-3 py-2.5">
          {actionBtn('Call', OUTLINE, async () => {
            window.open(`tel:${lead.mobile.replace(/\s/g, '')}`);
            const outcome = await ask.choice({
              title: 'How did the call go?',
              icon: 'phone',
              message: `Calling ${lead.mobile}. Tell us once you are done, so it goes on the lead's history.`,
              yesLabel: 'We spoke',
              noLabel: 'No answer',
              cancelLabel: 'Do not log it',
            });
            if (outcome) act(() => logActivity(lead.id, 'call', outcome === 'yes' ? 'connected' : 'missed', null));
          })}
          {actionBtn('WhatsApp', OUTLINE, () => {
            window.open(whatsappLink(lead.mobile, ''), '_blank');
            act(() => logActivity(lead.id, 'whatsapp', 'sent', null));
          })}
          {actionBtn('Email', OUTLINE, () => {
            if (!lead.email) return void ask.tell({ title: 'No email address yet', message: 'Add one with Edit, then Email will open your mail app.' });
            window.open(`mailto:${lead.email}`);
            act(() => logActivity(lead.id, 'email', 'sent', null));
          }, !lead.email)}
          {actionBtn('Quotation', 'primary', () => { window.location.href = `/quotation?lead=${lead.id}`; })}
          {actionBtn('Convert', 'success', async () => {
            if (await ask.confirm({
              title: 'Make this lead a customer?',
              icon: 'user-plus',
              message: 'A customer record is created from this lead, and the lead is closed as won.',
              confirmLabel: 'Make customer',
            })) {
              act(() => convertToCustomer(lead.id));
            }
          }, !!lead.convertedCustomerId)}
          {actionBtn(
            lead.sharedWithPartner ? `Shared: ${lead.sharedWithPartner}` : 'Lead Share',
            OUTLINE,
            async () => {
              const partner = await ask.text({
                title: 'Share this lead',
                icon: 'users',
                label: 'Business partner',
                message: 'Which business partner is this lead being shared with? Leave it empty to stop sharing.',
                defaultValue: lead.sharedWithPartner ?? '',
                confirmLabel: 'Save',
              });
              if (partner === null) return;
              act(() => updateLeadField(lead.id, { sharedWithPartner: partner || null }));
            },
          )}
          {actionBtn('Edit', OUTLINE, () => setEditOpen(true))}
          {actionBtn('Refresh', OUTLINE, () => act(async () => ({})))}
        </div>
      </div>
      {editOpen && (
        <EditLeadDialog
          lead={lead}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); void refresh(); }}
        />
      )}
    </DialogFrame>
  );
}

const fieldClass = 'w-full rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground';

export function EditLeadDialog({
  lead, onClose, onSaved,
}: {
  lead: Pick<LeadDetail, 'id' | 'editable'>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(lead.editable.firstName);
  const [lastName, setLastName] = useState(lead.editable.lastName ?? '');
  const [businessName, setBusinessName] = useState(lead.editable.businessName ?? '');
  const [mobile, setMobile] = useState(lead.editable.mobile);
  const [email, setEmail] = useState(lead.editable.email ?? '');
  const [requirement, setRequirement] = useState(lead.editable.requirement ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await updateLeadField(lead.id, {
        firstName, lastName: lastName || null, businessName: businessName || null,
        mobile, email: email || null, requirement: requirement || null,
      });
      if (r.error) { setError(r.error); return; }
      onSaved();
    });
  };

  return (
    <DialogFrame label="Edit lead" onClose={onClose} className="fixed inset-0 z-[210] grid place-items-center bg-navy/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-card shadow-overlay">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Edit lead</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="grid gap-3 p-4">
          {error && (
            <p className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-on-tint-danger">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              First name
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Last name
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Company
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Mobile
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Requirement
            <textarea value={requirement} onChange={(e) => setRequirement(e.target.value)} rows={3} className={fieldClass} />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} disabled={pending}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending || !firstName.trim() || !mobile.trim()}
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
