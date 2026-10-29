'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, type BadgeTone } from '@/components/ui/Layout';
import { ActionBar } from '@/components/document/ActionBar';
import { CustomFieldsPanel } from '@/components/custom-fields/CustomFieldsPanel';
import { DocPhotos } from '@/components/scan/DocPhotos';
import { ask } from '@/components/ui/ask';
import { formatCurrency } from '@/lib/format';
import { initials, whatsappLink } from '@/lib/revenue';
import type { EnquiryPage } from '@/server/enquiry-page';
import { addNote, convertToCustomer, deleteNote, logActivity, updateLeadField } from '../detail-actions';
import { EditLeadDialog } from '../LeadDrawer';

/**
 * ONE ENQUIRY, ON ITS OWN PAGE (29 Oct 2026). Replaces the lead pop-up: the
 * chain it started (quotation → order → installation → bill) on top, the one
 * next step as the only brand button, a stage bar, then properties · one
 * timeline · linked documents - the installation page's layout, built to
 * docs/vcare-design-system/DESIGN.md.
 */

type Data = Omit<EnquiryPage, 'sinceDate' | 'lastTalkAt' | 'nextActionAt' | 'notes' | 'comments' | 'activities' | 'quotations' | 'orders' | 'installations' | 'invoices' | 'stageChanges'> & {
  sinceDate: string; lastTalkAt: string | null; nextActionAt: string | null;
  notes: { id: string; body: string; createdAt: string; author: string | null }[];
  comments: { id: string; body: string; createdAt: string; author: string | null }[];
  activities: { id: string; channel: string; outcome: string | null; note: string | null; occurredAt: string; durationSec: number | null; author: string | null }[];
  quotations: { id: string; quotationNo: string; status: string; grandTotalPaise: number; quotationDate: string }[];
  orders: { id: string; orderNo: string; status: string; grandTotalPaise: number; orderDate: string; quotationId: string | null }[];
  installations: { id: string; challanNo: string; status: string; createdAt: string }[];
  invoices: { id: string; invoiceNo: string; grandTotalPaise: number; amountPaidPaise: number; invoiceDate: string }[];
  stageChanges: { id: string; from: string | null; to: string | null; at: string; author: string | null }[];
};

const IST = { timeZone: 'Asia/Kolkata' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric' });
const sentence = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "[Old system] [Work done] text" - the import's prefix, read back into a tag. */
function readNote(body: string) {
  const m = /^\[Old system(?: ([^\]]+))?\]\s*(?:\[([^\]]+)\]\s*)?([\s\S]*)$/.exec(body);
  return m ? { old: true, oldRef: m[1] ?? null, kind: m[2] ?? null, text: m[3] } : { old: false, oldRef: null, kind: null, text: body };
}

const CHANNEL: Record<string, { label: string; icon: IconName }> = {
  call: { label: 'Call', icon: 'phone' }, whatsapp: { label: 'WhatsApp', icon: 'whatsapp' }, email: { label: 'Email', icon: 'mail' },
  meeting: { label: 'Meeting', icon: 'users' }, quotation: { label: 'Quotation sent', icon: 'file-text' }, visit: { label: 'Site visit', icon: 'map-pin' },
};

type Item = { id: string; at: string; who: string | null; icon?: IconName; title: string; text?: string; tag?: { label: string; tone: BadgeTone }; group: 'notes' | 'talk' | 'stage' | 'old' | 'docs'; deletable?: boolean; href?: string };

function Card({ title, action, children, className = '', pad = true }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl bg-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 px-5 pt-4">
          <h2 className="text-title font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'px-5 pb-5 pt-3' : 'pt-3'}>{children}</div>
    </section>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2 py-1.5 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// A control that reads as its value until you touch it (Linear's property rows).
const quiet = 'w-full min-w-0 rounded-lg bg-transparent px-2 py-1.5 -mx-2 text-sm font-medium text-foreground transition hover:bg-muted focus:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:hover:bg-transparent';

export function EnquiryView({ d, canEdit, canNote, canConvert }: {
  d: Data; canEdit: boolean; canConvert: boolean;
  /** Notes and logged calls - anyone who can see the enquiry, as the pop-up allowed. */
  canNote: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'note' | 'comment' | 'call' | 'meeting'>('note');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState('connected');
  const [filter, setFilter] = useState<'all' | Item['group']>('all');

  const run = (fn: () => Promise<{ error?: string; ok?: boolean; message?: string }>, done?: string) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) { setError(r.error); return; }
    const say = r.message ?? done;
    if (say) { setToast(say); setTimeout(() => setToast(null), 3500); }
    router.refresh();
  });
  const save = (patch: Parameters<typeof updateLeadField>[1], done = 'Saved') => run(() => updateLeadField(d.id, patch), done);

  const phone = d.mobile.replace(/\s/g, '');

  const stage = d.stages.find((s) => s.id === d.stageId);
  const lost = !!stage?.isLost;
  const latestQ = d.quotations[0];
  const billed = d.invoices.reduce((n, i) => n + i.grandTotalPaise, 0);
  const received = d.invoices.reduce((n, i) => n + i.amountPaidPaise, 0);
  const lastNote = d.notes.find((n) => !readNote(n.body).old);

  const call = async () => {
    window.open(`tel:${phone}`);
    const r = await ask.choice({ title: 'How did the call go?', icon: 'phone', message: `Calling ${d.mobile}. Tell us once you are done, so it goes on the enquiry's history.`, yesLabel: 'We spoke', noLabel: 'No answer', cancelLabel: 'Do not log it' });
    if (r) run(() => logActivity(d.id, 'call', r === 'yes' ? 'connected' : 'missed', null), 'Call logged');
  };
  const convert = async () => {
    if (await ask.confirm({ title: 'Make this enquiry a customer?', icon: 'user-plus', message: 'A customer record is made from this enquiry, and the enquiry is closed as won.', confirmLabel: 'Make customer' })) {
      run(() => convertToCustomer(d.id));
    }
  };
  const quote = () => router.push(`/quotation?lead=${d.id}`);

  // The one thing that moves this enquiry forward (DESIGN.md §1.2).
  const next = (() => {
    if (lost || (d.isClosed && !stage?.isWon)) return null;
    if (!d.quotations.length) return { label: 'Make quotation', icon: 'file-text' as const, onClick: quote, why: 'No quotation yet. Price the requirement and send it.' };
    if (!d.convertedCustomerId && canConvert) return { label: 'Make customer', icon: 'user-plus' as const, onClick: convert, why: `${latestQ.quotationNo} is ${latestQ.status}. Once they agree, make them a customer to raise the order.` };
    if (!d.orders.length) return { label: 'Open quotation', icon: 'file-text' as const, onClick: () => router.push(`/quotation/${latestQ.id}`), why: `Turn ${latestQ.quotationNo} into an order when the customer confirms.` };
    return null;
  })();

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const n of [...d.notes, ...d.comments]) {
      const r = readNote(n.body);
      const isComment = d.comments.includes(n);
      out.push({
        id: n.id, at: n.createdAt, who: n.author, title: r.old ? (r.kind ?? 'Remark') : isComment ? 'Comment' : 'Note', text: r.text,
        tag: r.old ? { label: r.oldRef ? `Old system · ${r.oldRef}` : 'Old system', tone: 'neutral' } : isComment ? { label: 'Team only', tone: 'info' } : undefined,
        group: r.old ? 'old' : 'notes', deletable: !r.old,
      });
    }
    for (const a of d.activities) {
      const c = CHANNEL[a.channel] ?? { label: sentence(a.channel), icon: 'send' as IconName };
      out.push({ id: a.id, at: a.occurredAt, who: a.author, icon: c.icon, title: `${c.label}${a.outcome ? ` · ${sentence(a.outcome)}` : ''}`, text: a.note ?? undefined, group: 'talk' });
    }
    for (const s of d.stageChanges) out.push({ id: s.id, at: s.at, who: s.author, icon: 'arrow-right', title: `Stage: ${s.from ?? 'none'} → ${s.to ?? 'none'}`, group: 'stage' });
    for (const q of d.quotations) out.push({ id: `q-${q.id}`, at: q.quotationDate, who: null, icon: 'file-text', title: `Quotation ${q.quotationNo} · ${formatCurrency(q.grandTotalPaise)}`, group: 'docs', href: `/quotation/${q.id}` });
    for (const o of d.orders) out.push({ id: `o-${o.id}`, at: o.orderDate, who: null, icon: 'shopping-cart', title: `Sales order ${o.orderNo} · ${formatCurrency(o.grandTotalPaise)}`, group: 'docs', href: `/sales/orders/${o.id}` });
    for (const i of d.installations) out.push({ id: `i-${i.id}`, at: i.createdAt, who: null, icon: 'home', title: `Installation ${i.challanNo}`, group: 'docs', href: `/services/installations/${i.id}` });
    for (const b of d.invoices) out.push({ id: `b-${b.id}`, at: b.invoiceDate, who: null, icon: 'receipt', title: `Bill ${b.invoiceNo} · ${formatCurrency(b.grandTotalPaise)}`, group: 'docs', href: `/invoices/${b.id}` });
    out.push({ id: 'created', at: d.sinceDate, who: null, icon: 'sparkles', title: `Enquiry ${d.leadCode} raised${d.sourceName ? ` · from ${d.sourceName}` : ''}`, group: 'stage' });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [d]);
  const counts = useMemo(() => items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.group]: (m[i.group] ?? 0) + 1 }), {}), [items]);
  const shown = filter === 'all' ? items : items.filter((i) => i.group === filter);

  const submit = () => {
    const body = text.trim();
    if (mode === 'note' || mode === 'comment') {
      if (!body) return setError('Write something first.');
      run(() => addNote(d.id, body, mode), mode === 'note' ? 'Note added' : 'Comment added');
    } else {
      run(() => logActivity(d.id, mode, outcome, body || null), mode === 'call' ? 'Call logged' : 'Meeting logged');
    }
    setText('');
  };
  const remove = async (it: Item) => {
    if (await ask.confirm({ title: 'Delete this note?', message: it.text?.slice(0, 160), confirmLabel: 'Delete' })) run(() => deleteNote(it.id), 'Note deleted');
  };

  const chain: { kind: string; icon: IconName; label: string; sub: string; href?: string; current?: boolean }[] = [
    { kind: 'Enquiry', icon: 'sparkles', label: d.leadCode, sub: `${stage?.name ?? 'No stage'} · ${day(d.sinceDate)}`, current: true },
    latestQ
      ? { kind: d.quotations.length > 1 ? `Quotation (${d.quotations.length})` : 'Quotation', icon: 'file-text', label: latestQ.quotationNo, sub: `${latestQ.status} · ${formatCurrency(latestQ.grandTotalPaise)}`, href: `/quotation/${latestQ.id}` }
      : { kind: 'Quotation', icon: 'file-text', label: 'Not made yet', sub: 'Make quotation starts it' },
    d.orders[0]
      ? { kind: 'Sales order', icon: 'shopping-cart', label: d.orders[0].orderNo, sub: `${sentence(d.orders[0].status)} · ${formatCurrency(d.orders[0].grandTotalPaise)}`, href: `/sales/orders/${d.orders[0].id}` }
      : { kind: 'Sales order', icon: 'shopping-cart', label: 'Not yet', sub: 'from an agreed quotation' },
    d.installations[0]
      ? { kind: 'Installation', icon: 'home', label: d.installations[0].challanNo, sub: sentence(d.installations[0].status), href: `/services/installations/${d.installations[0].id}` }
      : { kind: 'Installation', icon: 'home', label: 'Not yet', sub: 'raised from the order' },
    d.invoices[0]
      ? { kind: 'Bill', icon: 'receipt', label: d.invoices[0].invoiceNo, sub: d.invoices[0].amountPaidPaise >= d.invoices[0].grandTotalPaise ? 'Paid' : `${formatCurrency(d.invoices[0].grandTotalPaise - d.invoices[0].amountPaidPaise)} due`, href: `/invoices/${d.invoices[0].id}` }
      : { kind: 'Bill', icon: 'receipt', label: 'Not billed', sub: 'when the work is done' },
  ];

  const filters: { key: 'all' | Item['group']; label: string }[] = [
    { key: 'all', label: 'Everything' }, { key: 'notes', label: 'Notes' }, { key: 'talk', label: 'Calls & messages' },
    { key: 'docs', label: 'Documents' }, { key: 'stage', label: 'Stage' }, { key: 'old', label: 'Old system' },
  ];

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {/* ---- the chain this enquiry started ------------------------------ */}
      <nav aria-label="Documents of this enquiry" className="overflow-x-auto rounded-2xl bg-card p-2 thin-scroll">
        <ol className="flex min-w-max items-stretch gap-1">
          {chain.map((s, i) => {
            const body = (
              <>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name={s.icon} className="h-3.5 w-3.5" />{s.kind}</span>
                <span className={`block text-sm font-semibold ${s.href || s.current ? '' : 'text-muted-foreground'}`}>{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.sub}</span>
              </>
            );
            const cls = `block min-w-[168px] rounded-xl px-3.5 py-2.5 transition ${s.current ? 'bg-brand/10 ring-1 ring-inset ring-brand/30' : s.href ? 'hover:bg-muted' : ''}`;
            return (
              <li key={s.kind} className="flex items-stretch gap-1">
                {i > 0 && <span className="flex items-center text-muted-foreground" aria-hidden><Icon name="chevron-right" className="h-3.5 w-3.5" /></span>}
                {s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls} aria-current={s.current ? 'page' : undefined}>{body}</div>}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---- who and where it stands ------------------------------------ */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-bold text-on-tint-brand">{initials(d.displayName)}</span>
          <div className="min-w-0">
            <h1 className="text-h1 font-bold">Enquiry {d.leadCode}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge tone={lost ? 'danger' : stage?.isWon ? 'success' : 'brand'}>{stage?.name ?? 'No stage'}</Badge>
              {d.convertedCustomerId && <Badge tone="success" icon="check-circle">Customer</Badge>}
              <span className="font-medium text-foreground">{d.displayName}</span>
              {d.businessName && <span>· {d.businessName}</span>}
              <span>· <a href={`tel:${phone}`} className="hover:text-brand hover:underline">{d.mobile}</a></span>
              <span>· since {day(d.sinceDate)}</span>
            </div>
          </div>
        </div>
        <Link href="/crm/leads" className="text-sm font-medium text-brand hover:underline">All enquiries</Link>
      </header>

      <ActionBar
        next={next ? { label: next.label, icon: next.icon, onClick: next.onClick } : undefined}
        whatsapp={{ label: 'WhatsApp', onClick: () => { window.open(whatsappLink(d.mobile, ''), '_blank'); run(() => logActivity(d.id, 'whatsapp', 'sent', null)); } }}
        actions={[
          { label: 'Call', icon: 'phone', iconTone: 'brand', onClick: call },
          ...(d.email ? [{ label: 'Email', icon: 'mail' as const, onClick: () => { window.open(`mailto:${d.email}`); run(() => logActivity(d.id, 'email', 'sent', null)); } }] : []),
          ...(canEdit ? [{ label: 'Edit', icon: 'pencil' as const, onClick: () => setEditing(true) }] : []),
        ]}
        more={[
          ...(d.quotations.length ? [{ label: 'Make another quotation', icon: 'file-text' as const, onClick: quote }] : []),
          ...(!d.convertedCustomerId && canConvert && next?.label !== 'Make customer' ? [{ label: 'Make customer', icon: 'user-plus' as const, onClick: convert }] : []),
          ...(d.customer ? [{ label: 'Open the customer', icon: 'user' as const, onClick: () => router.push(`/customers/${d.customer!.id}`) }] : []),
          ...(canEdit ? [{
            label: d.sharedWithPartner ? `Shared with ${d.sharedWithPartner}…` : 'Share with a partner…', icon: 'users' as const,
            onClick: async () => {
              const p = await ask.text({ title: 'Share this enquiry', icon: 'users', label: 'Business partner', message: 'Which business partner is it shared with? Leave it empty to stop sharing.', defaultValue: d.sharedWithPartner ?? '', confirmLabel: 'Save' });
              if (p !== null) save({ sharedWithPartner: p || null });
            },
          }] : []),
          { label: 'Print', icon: 'printer', onClick: () => window.print() },
        ]}
      />
      {error && <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-on-tint-danger">{error}</p>}

      {/* ---- stages ------------------------------------------------------ */}
      {/* A business's own stages are not a straight line (Vcare's run New → … → Paid / Close in
          no fixed order), so this is a picker, not a progress bar: open stages, then won, then lost. */}
      {d.stages.length > 0 && (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card px-5 py-3.5" aria-label="Stage">
          {[d.stages.filter((s) => !s.isWon && !s.isLost), d.stages.filter((s) => s.isWon), d.stages.filter((s) => s.isLost)].filter((g) => g.length).map((group, gi) => (
            <div key={gi} role="radiogroup" aria-label={gi === 0 ? 'Open stages' : 'Closing stages'} className="flex flex-wrap gap-1.5">
              {group.map((s) => {
                const cur = s.id === d.stageId;
                const on = s.isLost ? 'bg-danger text-brand-fg' : s.isWon ? 'bg-success text-brand-fg' : 'bg-foreground text-background';
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={cur} disabled={!canEdit || cur || pending}
                    onClick={() => save({ stageId: s.id }, `Moved to ${s.name}`)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition active:scale-[0.98] disabled:cursor-default ${cur ? on : 'bg-muted text-foreground hover:bg-border'}`}>
                    {cur && <Icon name="check" className="h-3.5 w-3.5" />}{s.name}
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px] xl:grid-cols-[300px_1fr_300px]">
        {/* ---- left: what to do and the enquiry's facts ------------------ */}
        <div className="space-y-4 lg:col-start-2 lg:row-start-1 xl:col-start-1">
          <Card title="Next step">
            <p className="text-sm">{next?.why ?? (lost ? 'Closed as lost.' : d.invoices.length ? 'Billed. Follow up on payment from the bill.' : 'The order is raised - the installation carries it from here.')}</p>
            {next && <Button variant="primary" icon={next.icon} className="mt-3 w-full" loading={pending} onClick={next.onClick}>{next.label}</Button>}
            <div className="mt-4">
              <Prop label="Follow up on">
                <input type="date" aria-label="Next follow-up" disabled={!canEdit} defaultValue={d.nextActionAt?.slice(0, 10) ?? ''} className={quiet}
                  // On blur, not change: typing a date by hand fires a change per digit (year 0002, 0020…).
                  onBlur={(e) => { const v = e.target.value; if (v !== (d.nextActionAt?.slice(0, 10) ?? '')) save({ nextActionAt: v || null }, v ? `Follow-up set for ${day(v)}` : 'Follow-up cleared'); }} />
              </Prop>
              <Prop label="Owner">
                <select aria-label="Owner" disabled={!canEdit} value={d.assignedToUserId ?? ''} className={quiet} onChange={(e) => save({ assignedToUserId: e.target.value || null }, 'Owner changed')}>
                  <option value="">Nobody yet</option>
                  {d.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select>
              </Prop>
              <Prop label="Stage">
                <select aria-label="Stage" disabled={!canEdit} value={d.stageId ?? ''} className={quiet} onChange={(e) => save({ stageId: e.target.value || null }, 'Stage changed')}>
                  {!d.stageId && <option value="">No stage</option>}
                  {d.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Prop>
              {d.dealStages.length > 0 && (
                <Prop label="Deal">
                  <select aria-label="Deal stage" disabled={!canEdit} value={d.dealStageId ?? ''} className={quiet} onChange={(e) => save({ dealStageId: e.target.value || null }, 'Deal stage changed')}>
                    <option value="">None</option>
                    {d.dealStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Prop>
              )}
              <Prop label="Worth">
                <input type="number" min={0} inputMode="decimal" aria-label="Potential value in rupees" disabled={!canEdit} defaultValue={d.potentialPaise ? d.potentialPaise / 100 : ''} placeholder="Add a value"
                  className={`${quiet} font-num tabular-nums`} onBlur={(e) => { const v = Number(e.target.value || 0); if (Math.round(v * 100) !== d.potentialPaise) save({ potential: v }, 'Value saved'); }} />
              </Prop>
            </div>
          </Card>

          <Card title="Customer" action={canEdit ? <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-brand hover:underline">Edit</button> : undefined}>
            <Prop label="Name"><span className="font-medium">{d.displayName}</span></Prop>
            {d.businessName && <Prop label="Business">{d.businessName}</Prop>}
            <Prop label="Mobile"><a href={`tel:${phone}`} className="font-medium text-brand hover:underline">{d.mobile}</a></Prop>
            <Prop label="Email">{d.email ? <a href={`mailto:${d.email}`} className="break-all text-brand hover:underline">{d.email}</a> : <span className="text-muted-foreground">Not given</span>}</Prop>
            {d.location && <Prop label="Area">{d.location}</Prop>}
            <Prop label="Came from">{d.sourceName ?? <span className="text-muted-foreground">Not recorded</span>}</Prop>
            <div className="mt-3 rounded-xl bg-muted/60 px-3.5 py-3">
              <p className="text-xs text-muted-foreground">What they asked for</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{d.requirement || 'Nothing written yet.'}</p>
            </div>
          </Card>

          <CustomFieldsPanel entity="lead" id={d.id} canEdit={canEdit} />
        </div>

        {/* ---- middle: one timeline --------------------------------------- */}
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 lg:row-span-2 xl:col-start-2">
          {canNote && (
            <Card>
              <div role="tablist" aria-label="What to add" className="flex flex-wrap gap-1.5">
                {([['note', 'Note', 'pencil'], ['comment', 'Team comment', 'users'], ['call', 'Log a call', 'phone'], ['meeting', 'Log a meeting', 'calendar']] as const).map(([k, l, ic]) => (
                  <button key={k} role="tab" type="button" aria-selected={mode === k} onClick={() => setMode(k)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition active:scale-[0.98] ${mode === k ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-border'}`}>
                    <Icon name={ic} className="h-3.5 w-3.5" />{l}
                  </button>
                ))}
              </div>
              {(mode === 'call' || mode === 'meeting') && (
                <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="How it went">
                  {(mode === 'call' ? [['connected', 'We spoke'], ['missed', 'No answer'], ['callback', 'Call back later']] : [['done', 'Done'], ['scheduled', 'Planned'], ['cancelled', 'Cancelled']]).map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={outcome === v} onClick={() => setOutcome(v)}
                      className={`h-8 rounded-full px-3 text-xs font-medium transition ${outcome === v ? 'bg-brand/10 text-on-tint-brand ring-1 ring-inset ring-brand/30' : 'text-muted-foreground hover:bg-muted'}`}>{l}</button>
                  ))}
                </div>
              )}
              <label className="sr-only" htmlFor="enq-text">Text</label>
              <textarea id="enq-text" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
                placeholder={mode === 'note' ? 'What happened, what was promised, what is next…' : mode === 'comment' ? 'A comment only your team sees…' : 'Anything worth remembering (optional)'}
                className="mt-3 w-full resize-y rounded-xl bg-muted/60 px-3.5 py-3 text-sm placeholder:text-muted-foreground focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter saves</span>
                <Button variant="primary" size="sm" icon="check" loading={pending} onClick={submit}>{mode === 'note' ? 'Add note' : mode === 'comment' ? 'Add comment' : 'Save'}</Button>
              </div>
            </Card>
          )}

          <Card title="Timeline" pad={false} action={<span className="text-xs text-muted-foreground tabular-nums">{items.length} entries</span>}>
            <div className="flex gap-1.5 overflow-x-auto px-5 pb-1 thin-scroll" role="tablist" aria-label="Show">
              {filters.filter((f) => f.key === 'all' || counts[f.key]).map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${filter === f.key ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-border'}`}>
                  {f.label}<span className="tabular-nums opacity-70">{f.key === 'all' ? items.length : counts[f.key]}</span>
                </button>
              ))}
            </div>
            <ol className="mt-2 pb-2">
              {shown.map((it) => (
                <li key={it.id} className="group relative flex gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${it.icon ? 'bg-muted text-muted-foreground' : 'bg-brand/10 text-on-tint-brand'}`} aria-hidden>
                    {it.icon ? <Icon name={it.icon} className="h-4 w-4" /> : initials(it.who ?? '?')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      {it.href ? <Link href={it.href} className="font-semibold hover:text-brand hover:underline">{it.title}</Link> : <span className="font-semibold">{it.title}</span>}
                      {it.tag && <Badge tone={it.tag.tone}>{it.tag.label}</Badge>}
                    </p>
                    {it.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{it.text}</p>}
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">{it.who ?? (it.group === 'old' ? 'Unknown' : 'Vcare')} · <time dateTime={it.at}>{when(it.at)}</time></p>
                  </div>
                  {it.deletable && canEdit && (
                    <button type="button" onClick={() => remove(it)} aria-label="Delete this note"
                      className="invisible grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-danger focus-visible:visible group-hover:visible group-focus-within:visible">
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Files and photos">
            <DocPhotos docType="lead" docId={d.id} />
          </Card>
        </div>

        {/* ---- right: everything linked, always in view -------------------- */}
        <aside aria-label="Linked documents" className="space-y-4 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
          <div className="space-y-4 xl:sticky xl:top-4">
            <Card title="Linked documents">
              <Group title="Customer" empty={canConvert ? 'Made when they agree - Make customer.' : 'Not a customer yet.'}>
                {d.customer && <Doc href={`/customers/${d.customer.id}`} no={d.customer.partyCode} what={d.customer.name} />}
              </Group>
              <Group title="Quotations" empty="None yet - Make quotation.">
                {d.quotations.map((q) => <Doc key={q.id} href={`/quotation/${q.id}`} no={q.quotationNo} what={`${q.status} · ${day(q.quotationDate)}`} amount={q.grandTotalPaise} />)}
              </Group>
              <Group title="Sales orders" empty="From an agreed quotation.">
                {d.orders.map((o) => <Doc key={o.id} href={`/sales/orders/${o.id}`} no={o.orderNo} what={sentence(o.status)} amount={o.grandTotalPaise} />)}
              </Group>
              <Group title="Installations" empty="Raised from the order.">
                {d.installations.map((i) => <Doc key={i.id} href={`/services/installations/${i.id}`} no={i.challanNo} what={sentence(i.status)} />)}
              </Group>
              <Group title="Bills" empty="When the work is done." last>
                {d.invoices.map((b) => <Doc key={b.id} href={`/invoices/${b.id}`} no={b.invoiceNo} what={b.amountPaidPaise >= b.grandTotalPaise ? 'Paid' : `${formatCurrency(b.grandTotalPaise - b.amountPaidPaise)} due`} amount={b.grandTotalPaise} />)}
              </Group>
            </Card>

            <Card title="At a glance">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
                <Fig label="Worth" value={d.potentialPaise ? formatCurrency(d.potentialPaise) : '-'} />
                <Fig label="Quoted" value={latestQ ? formatCurrency(latestQ.grandTotalPaise) : '-'} />
                <Fig label="Billed" value={billed ? formatCurrency(billed) : '-'} />
                <Fig label="Received" value={received ? formatCurrency(received) : '-'} />
                <Fig label="Open for" value={`${d.ageDays} days`} />
                <Fig label="Last spoke" value={d.lastTalkAt ? day(d.lastTalkAt) : 'Never'} />
              </dl>
              {lastNote && <p className="mt-4 rounded-xl bg-muted/60 px-3.5 py-3 text-xs text-muted-foreground">Last note: <span className="text-foreground">{readNote(lastNote.body).text.slice(0, 120)}</span></p>}
            </Card>
          </div>
        </aside>
      </div>

      {/* ---- phone: the three things you do with an enquiry, under the thumb -- */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 bg-card/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-raised backdrop-blur-md lg:hidden print:hidden">
        <Button variant="soft" icon="phone" className="flex-1" onClick={call}>Call</Button>
        <Button variant="wa" icon="whatsapp" className="flex-1" onClick={() => window.open(whatsappLink(d.mobile, ''), '_blank')}>WhatsApp</Button>
        {next && <Button variant="primary" icon={next.icon} className="flex-[1.4]" onClick={next.onClick}>{next.label}</Button>}
      </div>

      {toast && <div role="status" className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 animate-slide-up rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-overlay lg:bottom-6">{toast}</div>}

      {editing && (
        <EditLeadDialog
          lead={d}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setToast('Saved'); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Group({ title, empty, last, children }: { title: string; empty: string; last?: boolean; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className={last ? '' : 'mb-4'}>
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="mt-1 space-y-0.5">{has ? children : <p className="py-1 text-sm text-muted-foreground">{empty}</p>}</div>
    </div>
  );
}

function Doc({ href, no, what, amount }: { href: string; no: string; what: string; amount?: number }) {
  return (
    <Link href={href} className="-mx-2 flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-muted">
      <span className="min-w-0">
        <span className="block font-semibold text-brand">{no}</span>
        <span className="block truncate text-xs text-muted-foreground">{what}</span>
      </span>
      {amount !== undefined && <span className="shrink-0 font-num text-sm tabular-nums">{formatCurrency(amount)}</span>}
    </Link>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-num text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
