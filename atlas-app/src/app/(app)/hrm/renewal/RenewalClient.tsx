'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { ListPager } from '@/components/ui/ListPager';
import { useListParams } from '@/components/ui/useListParams';
import type { ServerPaging } from '@/components/ui/DataGrid';
import { BuyerSearch } from '@/components/document/BuyerSearch';
import { searchBuyersAction } from '@/app/actions/search-options';
import { POLICY_TYPES } from '@/lib/policy-renewals';
import { FREQUENCIES, type Frequency, type RenewalState } from '@/lib/renewal-cycle';
import { whatsappLink, whatsappNumberProblem } from '@/lib/revenue';
import { historyFor, markPaid, savePolicyRenewal, setStatus, whatsappFor } from './actions';

/**
 * Insurance & Policy - renewals (reworked 27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §1).
 * Company or client policies, a billing cycle, Mark paid (history + next due
 * date), Send on WhatsApp, and reminders 15 / 7 / 0 days before by default.
 */
export interface Item {
  id: string;
  title: string;
  policyType: string;
  provider: string | null;
  policyNumber: string | null;
  expiryDate: string;
  notes: string | null;
  isActive: boolean;
  ownerKind: 'company' | 'client';
  partyId: string | null;
  partyName: string | null;
  partyPhone: string | null;
  contactPhone: string | null;
  whatsappPhone: string | null;
  frequency: Frequency;
  expectedAmountPaise: number | null;
  ownOffsets: number[];
  offsets: number[];
  responsibleUserId: string | null;
  responsibleName: string | null;
  remindClient: boolean;
  status: string;
  closedReason: string | null;
  state: RenewalState;
  daysToExpiry: number;
  lastPaid: { dueDate: string; amountPaise: number; paidAt: string } | null;
  paidThisYearPaise: number;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const rupees = (p: number | null | undefined) => (p ? `₹${(p / 100).toLocaleString('en-IN')}` : '');
const freqLabel = (f: string) => FREQUENCIES.find((x) => x.key === f)?.label ?? f;
const inputClass = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

function StateBadge({ i }: { i: Item }) {
  const d = i.daysToExpiry;
  if (i.state === 'closed') return <Badge tone="neutral">Closed</Badge>;
  if (i.state === 'not_renewing') return <Badge tone="neutral">Not renewing</Badge>;
  if (i.state === 'overdue') return <Badge tone="danger">Overdue {Math.abs(d)}d</Badge>;
  if (i.state === 'due_today') return <Badge tone="danger">Due today</Badge>;
  if (i.state === 'due_soon') return <Badge tone="warning">Due in {d}d</Badge>;
  return <Badge tone="success">In {d}d</Badge>;
}

export function RenewalClient({
  items, paging, counts, card, type, types, rangeLabel, totalAll, canExport, views, canEdit, isSingleStore, people,
}: {
  items: Item[];
  paging: ServerPaging;
  counts: Record<string, number>;
  card: string;
  type: string | null;
  types: string[];
  rangeLabel: string;
  totalAll: number;
  canExport: boolean;
  views: FilterBarViews;
  canEdit: boolean;
  isSingleStore: boolean;
  people: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const list = useListParams();
  const cards: KpiCard[] = [
    { key: 'due', label: 'Due soon', count: counts.due ?? 0, icon: 'clock', tone: (counts.due ?? 0) > 0 ? 'warning' : 'default' },
    { key: 'expired', label: 'Overdue', count: counts.expired ?? 0, icon: 'alert-triangle', tone: (counts.expired ?? 0) > 0 ? 'danger' : 'default' },
    { key: 'active', label: 'Active', count: counts.active ?? 0, icon: 'check-circle', tone: 'success' },
    { key: 'inactive', label: 'Not renewing / closed', count: counts.inactive ?? 0, icon: 'ban' },
  ];
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [paying, setPaying] = useState<Item | null>(null);
  const [closing, setClosing] = useState<Item | null>(null);
  const [history, setHistory] = useState<{ item: Item; rows: Awaited<ReturnType<typeof historyFor>> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const editable = canEdit && isSingleStore;

  async function act(fn: () => Promise<{ error?: string; ok?: boolean; message?: string }>, done?: () => void) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    if (res.error) { setMsg({ tone: 'err', text: res.error }); return; }
    if (res.message) setMsg({ tone: 'ok', text: res.message });
    done?.();
    router.refresh();
  }

  /**
   * Straight to the customer's chat (6 Oct 2026).
   *
   * This used to open a browser prompt and ask for the number every single
   * time, and what was typed was thrown away afterwards - so the same number
   * was typed again next month. The number now lives on the policy
   * (`contactPhone`), so there is nothing to ask. With no number saved, the
   * policy opens for editing with the field waiting, which is the actual fix
   * for the next time too.
   */
  async function sendWhatsapp(i: Item) {
    if (!i.whatsappPhone) {
      setMsg({ tone: 'err', text: `${i.title}: no WhatsApp number saved yet. Add one here and the button will open the chat straight away.` });
      if (editable) setEditing(i);
      return;
    }
    const r = await whatsappFor(i.id);
    if (!r) return;
    window.open(whatsappLink(r.phone ?? i.whatsappPhone, r.text), '_blank', 'noopener');
  }

  return (
    <div>
      <PageHeader
        badge="IP"
        title="Insurance &amp; Policy"
        subtitle="Renewals that must not be missed - yours and your clients'"
        actions={editable ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add Policy</Button> : undefined}
      />

      {msg && (
        <Card className={`mb-3 p-3 text-sm ${msg.tone === 'err' ? 'border-danger/40 bg-danger/5 text-danger' : 'border-success/40 bg-success/5 text-success'}`}>
          <span role={msg.tone === 'err' ? 'alert' : 'status'}>{msg.text}</span>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add or mark policies paid.</p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Title, client, type, provider, policy number…"
        dates={{ defaultPreset: 'all', label: 'Due', activeLabel: rangeLabel }}
        extra={types.length > 1 ? (
          <>
            <label htmlFor="fb-ptype" className="sr-only">Policy type</label>
            <select id="fb-ptype" value={type ?? ''} onChange={(e) => list.set({ type: e.target.value || null })}
              className={`h-10 rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-brand ${type ? 'border-brand bg-brand/5 font-medium text-brand' : 'border-border'}`}>
              <option value="">Type: all</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        ) : undefined}
        shown={paging.total}
        clearKeys={['card', 'type']}
        exportScreen={canExport ? 'renewals' : null}
        views={views}
      />
      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k && k !== 'active' ? k : null })} columns={4} />

      <SectionCard title={`${paging.total} polic${paging.total === 1 ? 'y' : 'ies'}`} icon="lock" bodyClassName="p-0">
        {items.length === 0 ? (
          <EmptyState icon="lock" title={totalAll === 0 ? 'Nothing tracked yet' : 'Nothing matches'}
            hint={totalAll === 0 ? 'Add an insurance policy, licence, AMC or a client’s policy to be reminded 15 days, 7 days and on the day it is due.' : 'Try another card, a wider date range, or Clear all filters.'} />
        ) : (
          <div className="divide-y divide-border">
            {items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{i.title}</p>
                    <StateBadge i={i} />
                    <Badge tone="neutral">{i.policyType}</Badge>
                    <Badge tone={i.ownerKind === 'client' ? 'info' : 'neutral'}>{i.ownerKind === 'client' ? `Client: ${i.partyName ?? '-'}` : 'Company'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {freqLabel(i.frequency)} · next due <strong className="text-foreground">{fmt(i.expiryDate)}</strong>
                    {i.expectedAmountPaise ? ` · ${rupees(i.expectedAmountPaise)}` : ''}
                    {[i.provider, i.policyNumber].filter(Boolean).length ? ` · ${[i.provider, i.policyNumber].filter(Boolean).join(' · ')}` : ''}
                    {` · reminders ${i.offsets.map((o) => (o === 0 ? 'on the day' : `${o}d`)).join(', ')}`}
                    {i.responsibleName ? ` · ${i.responsibleName}` : ''}
                  </p>
                  {/* On the row, so a policy with nobody to message is obvious before the due date, not on the day. */}
                  <p className="text-xs text-muted-foreground">
                    {i.whatsappPhone
                      ? <>WhatsApp to <strong className="text-foreground">{i.whatsappPhone}</strong>{!i.contactPhone && i.partyPhone ? ' (from the client record)' : ''}</>
                      : <span className="text-warning">No WhatsApp number yet - add one with Edit.</span>}
                  </p>
                  {i.lastPaid && (
                    <p className="text-xs text-muted-foreground">
                      Last paid {rupees(i.lastPaid.amountPaise) || '-'} on {fmt(i.lastPaid.paidAt)} (due {fmt(i.lastPaid.dueDate)}){i.paidThisYearPaise ? ` · ${rupees(i.paidThisYearPaise)} in the last 12 months` : ''}
                    </p>
                  )}
                  {i.closedReason && i.state !== 'upcoming' && <p className="text-xs text-muted-foreground">Reason: {i.closedReason}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button size="sm" icon="whatsapp" onClick={() => void sendWhatsapp(i)}>WhatsApp</Button>
                  {editable && i.isActive && <Button size="sm" variant="primary" icon="check" onClick={() => setPaying(i)}>Mark paid</Button>}
                  <Button size="sm" onClick={() => void historyFor(i.id).then((rows) => setHistory({ item: i, rows }))}>History</Button>
                  {editable && <Button size="sm" icon="pencil" onClick={() => setEditing(i)}>Edit</Button>}
                  {editable && (i.isActive
                    ? <Button size="sm" onClick={() => setClosing(i)}>Stop</Button>
                    : <Button size="sm" disabled={busy} onClick={() => void act(() => setStatus(i.id, 'active', null))}>Reopen</Button>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      {paging.total > 0 && <ListPager paging={paging} />}

      {editing && (
        <PolicyForm item={editing === 'new' ? null : editing} people={people} busy={busy} onClose={() => setEditing(null)}
          onSave={(id, form) => void act(() => savePolicyRenewal(id, form), () => setEditing(null))} />
      )}
      {paying && (
        <PayDialog item={paying} busy={busy} onClose={() => setPaying(null)}
          onPay={(amount, note) => void act(() => markPaid(paying.id, amount, note), () => setPaying(null))} />
      )}
      {closing && (
        <CloseDialog item={closing} busy={busy} onClose={() => setClosing(null)}
          onDo={(status, reason) => void act(() => setStatus(closing.id, status, reason), () => setClosing(null))} />
      )}
      {history && (
        <Modal title={`History - ${history.item.title}`} icon="clock" size="md" onClose={() => setHistory(null)}
          footer={<Button onClick={() => setHistory(null)}>Close</Button>}>
          {history.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing marked paid yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-micro uppercase text-muted-foreground"><th className="py-1 text-start">Due</th><th className="text-start">Paid on</th><th className="text-end">Amount</th><th className="text-start ps-3">By</th></tr></thead>
              <tbody>
                {history.rows.map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="py-1.5">{fmt(h.dueDate)}</td><td>{fmt(h.paidAt)}</td>
                    <td className="text-end tabular-nums">{rupees(h.amountPaise) || '₹0'}</td><td className="ps-3">{h.paidBy ?? '-'}{h.note ? ` · ${h.note}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}

function PolicyForm({ item, people, busy, onClose, onSave }: {
  item: Item | null; people: { id: string; fullName: string }[]; busy: boolean;
  onClose: () => void; onSave: (id: string | null, form: Parameters<typeof savePolicyRenewal>[1]) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [policyType, setPolicyType] = useState(item?.policyType ?? 'Insurance');
  const [provider, setProvider] = useState(item?.provider ?? '');
  const [policyNumber, setPolicyNumber] = useState(item?.policyNumber ?? '');
  const [due, setDue] = useState(item ? new Date(item.expiryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [ownerKind, setOwnerKind] = useState<'company' | 'client'>(item?.ownerKind ?? 'company');
  const [party, setParty] = useState<{ id: string; label: string } | null>(item?.partyId ? { id: item.partyId, label: item.partyName ?? '' } : null);
  const [frequency, setFrequency] = useState<string>(item?.frequency ?? 'yearly');
  const [amount, setAmount] = useState(item?.expectedAmountPaise ? String(item.expectedAmountPaise / 100) : '');
  const [ownDays, setOwnDays] = useState(item?.ownOffsets.length ? item.ownOffsets.join(', ') : '');
  const [responsible, setResponsible] = useState(item?.responsibleUserId ?? '');
  const [remindClient, setRemindClient] = useState(item?.remindClient ?? false);
  const [contactPhone, setContactPhone] = useState(item?.contactPhone ?? '');
  const phoneProblem = whatsappNumberProblem(contactPhone);

  return (
    <Modal title={item ? 'Edit policy' : 'Add policy'} icon="lock" size="lg" onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!title.trim() || !due || !!phoneProblem || (ownerKind === 'client' && !party)}
          onClick={() => onSave(item?.id ?? null, {
            title, policyType, provider: provider || null, policyNumber: policyNumber || null, expiryDate: due, notes: notes || null,
            ownerKind, partyId: ownerKind === 'client' ? party?.id ?? null : null, frequency,
            expectedAmountPaise: amount.trim() ? Math.round(Number(amount) * 100) : null,
            reminderOffsets: ownDays.split(/[,\s]+/).filter(Boolean).map(Number),
            responsibleUserId: responsible || null, remindClient, contactPhone: contactPhone.trim() || null,
          })}>
          {item ? 'Save changes' : 'Add policy'}
        </Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Whose policy" htmlFor="p-owner">
          <select id="p-owner" value={ownerKind} onChange={(e) => setOwnerKind(e.target.value as 'company' | 'client')} className={inputClass}>
            <option value="company">Our company</option>
            <option value="client">A client</option>
          </select>
        </Field>
        {ownerKind === 'client' ? (
          <Field label="Client" required htmlFor="p-client">
            <BuyerSearch id="p-client" search={searchBuyersAction} selected={party ? { id: party.id, label: party.label } : null}
              onPick={(row) => setParty(row ? { id: row.id, label: row.company ? `${row.company} - ${row.name}` : row.name } : null)} />
          </Field>
        ) : <div />}
        <Field label="Title" required htmlFor="p-title">
          <input id="p-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fire insurance - godown" className={inputClass} />
        </Field>
        <Field label="Type" htmlFor="p-type">
          <select id="p-type" value={policyType} onChange={(e) => setPolicyType(e.target.value)} className={inputClass}>
            {POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Paid" htmlFor="p-freq">
          <select id="p-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
            {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Next due date" required htmlFor="p-due">
          <input id="p-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Amount each time (₹)" htmlFor="p-amount" hint="Optional - shown in reminders and the WhatsApp message.">
          <input id="p-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Remind days before" htmlFor="p-days" hint="Leave empty for the business default (15, 7, on the day).">
          <input id="p-days" value={ownDays} onChange={(e) => setOwnDays(e.target.value)} placeholder="30, 15, 7, 0" className={inputClass} />
        </Field>
        <Field label="Provider" htmlFor="p-provider">
          <input id="p-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass} />
        </Field>
        <Field label="WhatsApp number" htmlFor="p-phone"
          hint={ownerKind === 'client'
            ? 'Where the renewal message goes. Empty = the number on the client record.'
            : 'Where the renewal message goes - the agent or the office that renews this.'}>
          <input id="p-phone" type="tel" inputMode="tel" value={contactPhone} placeholder="98765 43210"
            onChange={(e) => setContactPhone(e.target.value)} className={inputClass}
            aria-invalid={!!phoneProblem} aria-describedby={phoneProblem ? 'p-phone-err' : undefined} />
          {phoneProblem && <p id="p-phone-err" role="alert" className="mt-1 text-xs text-danger">{phoneProblem}</p>}
        </Field>
        <Field label="Policy / licence number" htmlFor="p-number">
          <input id="p-number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Responsible person" htmlFor="p-resp" hint="Gets the reminders too. The owner always does.">
          <select id="p-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} className={inputClass}>
            <option value="">- Owner / admins only -</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </Field>
        {ownerKind === 'client' && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={remindClient} onChange={(e) => setRemindClient(e.target.checked)} />
            Remind the client too (once automatic WhatsApp is on)
          </label>
        )}
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="p-notes">
            <textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="field-input" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function PayDialog({ item, busy, onClose, onPay }: { item: Item; busy: boolean; onClose: () => void; onPay: (amount: number, note: string | null) => void }) {
  const [amount, setAmount] = useState(item.expectedAmountPaise ? String(item.expectedAmountPaise / 100) : '');
  const [note, setNote] = useState('');
  return (
    <Modal title={`Mark paid - ${item.title}`} subtitle={`Due ${fmt(item.expiryDate)} · ${freqLabel(item.frequency)}`} icon="check" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={amount.trim() === ''} onClick={() => onPay(Number(amount), note || null)}>Mark paid</Button></>}>
      <div className="grid gap-3">
        <Field label="Amount paid (₹)" required htmlFor="pay-amount">
          <input id="pay-amount" type="number" min={0} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Note" htmlFor="pay-note"><input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Cheque no., receipt no." /></Field>
        <p className="text-xs text-muted-foreground">
          {item.frequency === 'one_time' ? 'A one-time policy closes once paid.' : `The next due date moves one ${freqLabel(item.frequency).toLowerCase()} cycle on from ${fmt(item.expiryDate)}, and the reminders start again for it.`}
        </p>
      </div>
    </Modal>
  );
}

function CloseDialog({ item, busy, onClose, onDo }: { item: Item; busy: boolean; onClose: () => void; onDo: (status: 'not_renewing' | 'closed', reason: string) => void }) {
  const [status, setStatusChoice] = useState<'not_renewing' | 'closed'>('not_renewing');
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Stop reminders - ${item.title}`} icon="ban" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => onDo(status, reason.trim())}>Save</Button></>}>
      <div className="grid gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={status === 'not_renewing'} onChange={() => setStatusChoice('not_renewing')} /> Not renewing this time</label>
        <label className="flex items-center gap-2"><input type="radio" checked={status === 'closed'} onChange={() => setStatusChoice('closed')} /> Close the policy</label>
        <Field label="Reason" required htmlFor="close-reason"><input id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} /></Field>
        <p className="text-xs text-muted-foreground">History is kept. Reopen any time.</p>
      </div>
    </Modal>
  );
}

