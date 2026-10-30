'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { useListParams } from '@/components/ui/useListParams';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, EmptyState, Field, SectionCard } from '@/components/ui/Layout';
import { ListFilter } from '@/components/ui/ListFilter';
import type { deskAction, teamFollowUpAction } from '@/app/actions/inbox';
import type { MyRequestItem } from '@/server/approvals';
import type { DeskKind, DeskRequestInput } from '@/server/my-desk';
import { NOTE_KINDS, ageTone, categoryOf } from '@/lib/desk-categories';

/**
 * My Desk parts (27 Sep 2026, streamline roadmap S2):
 *  - MyRequestsTab: every request I raised, from each module's own table,
 *    plus business approvals I asked for (orders, POs, challans).
 *  - NewRequestModal: one form for every kind of request.
 *  - TeamTab (owner): who has unread notifications, overdue reminders or
 *    approvals waiting on them.
 */
export type Desk = Awaited<ReturnType<typeof deskAction>>;
type Team = Awaited<ReturnType<typeof teamFollowUpAction>>;
type TeamRow = NonNullable<Team>[number];

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string | null) => {
  if (!iso) return '-';
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.floor(h / 24)} days ago`;
};
const STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  accepted: { label: 'Accepted', tone: 'success' },
  fulfilled: { label: 'Handed over', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const DESK_TYPES = new Set(['leave', 'wfh', 'comp_off', 'leave_allocation', 'reimbursement', 'leave_encashment', 'asset_request', 'resignation']);

/**
 * THE SORT EVERY MY DESK TAB OPENS WITH: newest first (Pravin, 9 Oct 2026).
 * A missing date sorts last either way, so an undated row never pushes the
 * dated ones down.
 */
export const newestBy = <T,>(of: (r: T) => string | null | undefined) => (a: T, b: T) =>
  (Date.parse(of(b) ?? '') || 0) - (Date.parse(of(a) ?? '') || 0);
export const oldestBy = <T,>(of: (r: T) => string | null | undefined) => (a: T, b: T) =>
  (Date.parse(of(a) ?? '') || Infinity) - (Date.parse(of(b) ?? '') || Infinity);
export const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

/**
 * One row for both kinds of request (9 Oct 2026), so one filter bar covers
 * both lists: what I asked for myself (leave, claims...) and the documents I
 * sent for approval (orders, POs, challans).
 */
interface ReqRow {
  key: string;
  kind: 'desk' | 'doc';
  title: string;
  typeLabel: string;
  status: string;
  tone: 'warning' | 'success' | 'danger' | 'neutral';
  raisedAt: string;
  decidedAt: string | null;
  amountPaise: number | null;
  line: string;
  note: string | null;
  href: string | null;
}

export function MyRequestsTab({ desk, approvals, onNew }: { desk: Desk | null; approvals: MyRequestItem[]; onNew: () => void }) {
  const rows = useMemo<ReqRow[]>(() => {
    const mine = (desk?.requests ?? []).map((r): ReqRow => {
      const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
      return {
        key: `${r.kind}:${r.id}`, kind: 'desk', title: r.label, typeLabel: r.label, status: st.label, tone: st.tone,
        raisedAt: r.createdAt, decidedAt: r.decidedAt, amountPaise: null, note: r.decisionNote, href: null,
        line: [
          r.detail, `sent ${when(r.createdAt)}`,
          r.status === 'pending' ? (r.waitingOn.length ? `waiting on ${r.waitingOn.join(' or ')}` : 'waiting for the office to decide') : null,
          r.decidedAt ? `decided ${when(r.decidedAt)}` : null,
        ].filter(Boolean).join(' · '),
      };
    });
    const docs = approvals.filter((a) => !DESK_TYPES.has(a.type)).map((r): ReqRow => ({
      key: r.requestId, kind: 'doc', title: r.title, typeLabel: r.typeLabel,
      status: r.status === 'PENDING' ? 'Waiting' : r.status === 'APPROVED' ? 'Approved' : 'Rejected',
      tone: r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : 'warning',
      raisedAt: r.since, decidedAt: r.decidedAt, amountPaise: r.amountPaise, note: r.note, href: r.href,
      line: [
        r.typeLabel, `sent ${when(r.since)}`,
        r.amountPaise ? `₹${(r.amountPaise / 100).toLocaleString('en-IN')}` : null,
        r.status === 'PENDING' && r.waitingOn.length ? `waiting on ${r.waitingOn.join(' or ')}${r.level > 1 ? ` (level ${r.level})` : ''}` : null,
        r.decidedAt ? `decided ${when(r.decidedAt)}` : null,
      ].filter(Boolean).join(' · '),
    }));
    return [...mine, ...docs];
  }, [desk, approvals]);

  const types = uniq(rows.map((r) => r.typeLabel));
  const item = (r: ReqRow) => (
    <li key={r.key} className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{r.title}<Badge tone={r.tone}>{r.status}</Badge></p>
        <p className="text-xs text-muted-foreground">{r.line}</p>
        {r.note && <p className="mt-0.5 text-xs">Note: {r.note}</p>}
      </div>
      {r.href && <Link href={r.href} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted">Open</Link>}
    </li>
  );

  return (
    <SectionCard title="My requests" icon="send" bodyClassName="p-0"
      action={<Button size="sm" variant="primary" icon="plus" onClick={onNew}>New request</Button>}>
      {!desk ? <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
        : rows.length === 0 ? (
          <EmptyState icon="send" title="Nothing asked for yet"
            hint="Leave, work from home, comp-off, a reimbursement, an asset - press New request. You will see here who it waits on and the decision." />
        ) : (
          <ListFilter
            rows={rows} paramKey="rq" noun="requests"
            placeholder="What, status, amount, who it waits on…"
            searchOn={(r) => [r.title, r.typeLabel, r.status, r.line, r.note]}
            chips={types.map((t) => ({ value: t, label: t, count: rows.filter((r) => r.typeLabel === t).length }))}
            chipOf={(r) => r.typeLabel} chipLabel="Request type"
            dates={[
              { key: 'raised', label: 'Raised on', of: (r) => r.raisedAt },
              { key: 'decided', label: 'Decided on', of: (r) => r.decidedAt },
            ]}
            sorts={[
              { key: 'new', label: 'Newest first', compare: newestBy((r) => r.raisedAt) },
              { key: 'old', label: 'Oldest first', compare: oldestBy((r) => r.raisedAt) },
              { key: 'decided', label: 'Recently decided', compare: newestBy((r) => r.decidedAt) },
              { key: 'amt', label: 'Amount: high to low', compare: (a, b) => (b.amountPaise ?? -1) - (a.amountPaise ?? -1) },
              { key: 'status', label: 'Status', compare: (a, b) => a.status.localeCompare(b.status) },
            ]}
            selects={[{ key: 'st', label: 'Status', of: (r) => r.status, options: uniq(rows.map((r) => r.status)) }]}
            amountOf={(r) => (r.amountPaise == null ? null : r.amountPaise / 100)}
            exportAs={{ title: 'My requests', columns: [
              { header: 'What', value: (r) => r.title }, { header: 'Type', value: (r) => r.typeLabel },
              { header: 'Status', value: (r) => r.status }, { header: 'Raised', value: (r) => r.raisedAt.slice(0, 10) },
              { header: 'Decided', value: (r) => r.decidedAt?.slice(0, 10) ?? '' },
              { header: 'Amount (Rs)', value: (r) => (r.amountPaise != null ? r.amountPaise / 100 : '') },
              { header: 'Details', value: (r) => r.line },
            ] }}
          >
            {(shown) => {
              if (shown.length === 0) {
                return <EmptyState icon="search" title="Nothing matches" hint="Widen the date range or clear a filter." />;
              }
              const mine = shown.filter((r) => r.kind === 'desk');
              const docs = shown.filter((r) => r.kind === 'doc');
              return (
                <>
                  {mine.length > 0 && <ul>{mine.map(item)}</ul>}
                  {docs.length > 0 && (
                    <>
                      <p className="border-y border-border bg-muted/30 px-4 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                        Documents I sent for approval
                      </p>
                      <ul>{docs.map(item)}</ul>
                    </>
                  )}
                </>
              );
            }}
          </ListFilter>
        )}
    </SectionCard>
  );
}


// ------------------------------------------------------------------ New request

const CHOICES: { kind: DeskKind; label: string; icon: IconName; hint: string }[] = [
  { kind: 'leave', label: 'Leave', icon: 'calendar', hint: 'One or more days off' },
  { kind: 'half_day', label: 'Half day', icon: 'clock', hint: 'Half a day off' },
  { kind: 'wfh', label: 'Work from home', icon: 'home', hint: 'Working, not in office' },
  { kind: 'comp_off', label: 'Comp-off', icon: 'rotate-ccw', hint: 'Use days earned for extra work' },
  { kind: 'reimbursement', label: 'Reimbursement', icon: 'receipt', hint: 'Money you spent for work' },
  { kind: 'asset_request', label: 'Asset', icon: 'package', hint: 'Laptop, phone, tools…' },
  { kind: 'leave_allocation', label: 'Extra leave days', icon: 'plus', hint: 'Ask for more of a leave type' },
  { kind: 'leave_encashment', label: 'Leave encashment', icon: 'credit-card', hint: 'Unused leave paid out' },
  { kind: 'resignation', label: 'Resignation', icon: 'log-out', hint: 'Start your notice period' },
];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function NewRequestModal({ options, singleStore, busy, onClose, onSend }: {
  options: Desk['options'] | null; singleStore: boolean; busy: boolean;
  onClose: () => void; onSend: (input: DeskRequestInput) => void;
}) {
  const [kind, setKind] = useState<DeskKind | null>(null);
  const [v, setV] = useState<DeskRequestInput & { confirm?: boolean }>({ kind: 'leave' });
  useEffect(() => { if (kind) setV({ kind, fromDate: today(), toDate: today(), expenseDate: today(), category: 'travel', days: 1, noticeDays: 30 }); }, [kind]);
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));
  const types = options?.leaveTypes ?? [];
  const bal = (id: string | null | undefined) => types.find((t) => t.id === id)?.balanceDays;

  const ready = (() => {
    if (!kind) return false;
    if (kind === 'leave_allocation' || kind === 'leave_encashment') return !!v.leaveTypeId && (v.days ?? 0) > 0 && (kind === 'leave_encashment' || !!v.reason?.trim());
    if (kind === 'reimbursement') return (v.amountRupees ?? 0) > 0 && !!v.expenseDate;
    if (kind === 'asset_request') return !!v.assetType?.trim();
    if (kind === 'resignation') return !!v.lastWorkingDay && !!v.confirm;
    if (kind === 'comp_off') return (v.days ?? 0) > 0;
    return !!v.fromDate;
  })();

  const typeSelect = (required: boolean) => (
    <Field label="Leave type" required={required} htmlFor="nr-type">
      <select id="nr-type" value={v.leaveTypeId ?? ''} onChange={(e) => set({ leaveTypeId: e.target.value || null })} className="field-input">
        <option value="">{required ? 'Choose…' : 'Not specified'}</option>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.balanceDays !== null ? ` - ${t.balanceDays} left` : ''}</option>)}
      </select>
    </Field>
  );
  const reason = (label = 'Reason', required = false) => (
    <Field label={label} required={required} htmlFor="nr-reason">
      <textarea id="nr-reason" rows={2} value={v.reason ?? ''} onChange={(e) => set({ reason: e.target.value })} className="field-input" />
    </Field>
  );

  return (
    <Modal title={kind ? CHOICES.find((c) => c.kind === kind)!.label : 'New request'} icon="send" size="md" onClose={onClose}
      footer={kind ? (
        <>
          <Button onClick={() => setKind(null)}>Back</Button>
          <Button variant="primary" loading={busy} disabled={!ready || !singleStore} onClick={() => onSend({ ...v, kind })}>Send request</Button>
        </>
      ) : <Button onClick={onClose}>Close</Button>}>
      {!singleStore && (
        <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-on-tint-warning">
          Pick your branch in the top bar first - requests belong to one branch.
        </p>
      )}
      {!kind ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CHOICES.filter((c) => c.kind !== 'resignation' || !options?.hasOpenResignation).map((c) => (
            <button key={c.kind} type="button" onClick={() => setKind(c.kind)}
              className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-start transition hover:border-brand hover:bg-brand/5">
              <Icon name={c.icon} className="h-5 w-5 text-brand" />
              <span className="text-sm font-semibold">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {(kind === 'leave' || kind === 'wfh') && (
            <>
              {kind === 'leave' && typeSelect(false)}
              {kind === 'leave' && v.leaveTypeId && bal(v.leaveTypeId) !== null && bal(v.leaveTypeId) !== undefined && (
                <p className="text-xs text-muted-foreground">You have {bal(v.leaveTypeId)} day(s) of this left this year.</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" required htmlFor="nr-from"><input id="nr-from" type="date" value={v.fromDate ?? ''} onChange={(e) => set({ fromDate: e.target.value, toDate: v.toDate && v.toDate < e.target.value ? e.target.value : v.toDate })} className="field-input" /></Field>
                <Field label="To" required htmlFor="nr-to"><input id="nr-to" type="date" min={v.fromDate} value={v.toDate ?? ''} onChange={(e) => set({ toDate: e.target.value })} className="field-input" /></Field>
              </div>
              {reason()}
            </>
          )}
          {kind === 'half_day' && (
            <>
              {typeSelect(false)}
              <Field label="Date" required htmlFor="nr-from"><input id="nr-from" type="date" value={v.fromDate ?? ''} onChange={(e) => set({ fromDate: e.target.value })} className="field-input" /></Field>
              {reason()}
            </>
          )}
          {kind === 'comp_off' && (
            <>
              <p className="text-xs text-muted-foreground">You have {options?.compOffAvailable ?? 0} comp-off day(s) available.</p>
              <Field label="Days to use" required htmlFor="nr-days"><input id="nr-days" type="number" min={1} max={30} value={v.days ?? ''} onChange={(e) => set({ days: Number(e.target.value) })} className="field-input" /></Field>
              {reason()}
            </>
          )}
          {kind === 'leave_allocation' && (
            <>
              {typeSelect(true)}
              <Field label="Extra days needed" required htmlFor="nr-days"><input id="nr-days" type="number" min={1} max={365} value={v.days ?? ''} onChange={(e) => set({ days: Number(e.target.value) })} className="field-input" /></Field>
              {reason('Why do you need them', true)}
            </>
          )}
          {kind === 'leave_encashment' && (
            <>
              {typeSelect(true)}
              <Field label="Days to encash" required htmlFor="nr-days"><input id="nr-days" type="number" min={0.5} step={0.5} value={v.days ?? ''} onChange={(e) => set({ days: Number(e.target.value) })} className="field-input" /></Field>
              <p className="text-xs text-muted-foreground">The amount is worked out from your salary contract when the request is saved.</p>
            </>
          )}
          {kind === 'reimbursement' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)" required htmlFor="nr-amt"><input id="nr-amt" type="number" min={1} value={v.amountRupees ?? ''} onChange={(e) => set({ amountRupees: Number(e.target.value) })} className="field-input" /></Field>
                <Field label="Spent on" required htmlFor="nr-date"><input id="nr-date" type="date" value={v.expenseDate ?? ''} onChange={(e) => set({ expenseDate: e.target.value })} className="field-input" /></Field>
              </div>
              <Field label="Category" htmlFor="nr-cat">
                <select id="nr-cat" value={v.category ?? 'travel'} onChange={(e) => set({ category: e.target.value })} className="field-input capitalize">
                  {(options?.categories ?? ['travel', 'medical', 'food', 'other']).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              {reason('What was it for')}
            </>
          )}
          {kind === 'asset_request' && (
            <>
              <Field label="What do you need" required htmlFor="nr-asset"><input id="nr-asset" value={v.assetType ?? ''} onChange={(e) => set({ assetType: e.target.value })} placeholder="Laptop, drill machine, SIM card…" className="field-input" /></Field>
              {reason()}
            </>
          )}
          {kind === 'resignation' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Last working day" required htmlFor="nr-lwd"><input id="nr-lwd" type="date" min={today()} value={v.lastWorkingDay ?? ''} onChange={(e) => set({ lastWorkingDay: e.target.value })} className="field-input" /></Field>
                <Field label="Notice period (days)" htmlFor="nr-notice"><input id="nr-notice" type="number" min={0} value={v.noticeDays ?? 0} onChange={(e) => set({ noticeDays: Number(e.target.value) })} className="field-input" /></Field>
              </div>
              {reason()}
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={!!v.confirm} onChange={(e) => set({ confirm: e.target.checked })} className="mt-0.5" />
                I want to resign. This goes to my manager and HR for a decision.
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Team (owner)

/**
 * TEAM FOLLOW-UP, REDONE (30 Oct 2026). It was one table of seven numbers per
 * person; the owner had to read every row to find who to chase. Now each
 * person falls in one state, worst first, and the strip on top counts them:
 *  - Blocking others: approvals sit with them, so someone else is waiting.
 *  - Behind: reminders past due, or notifications unread for over a week.
 *  - Keeping up: some unread, all recent.
 *  - All clear.
 * Each card says what they are behind on (unread by kind, approvals by
 * category, oldest first) and Remind sends them a reminder that rings on
 * their phone (decision 12: the owner may remind anybody).
 */
type TeamState = 'blocking' | 'behind' | 'keeping' | 'clear';
const STATES: { key: TeamState; label: string; icon: IconName; tone: 'danger' | 'warning' | 'info' | 'success' }[] = [
  { key: 'blocking', label: 'Blocking others', icon: 'alert-triangle', tone: 'danger' },
  { key: 'behind', label: 'Behind', icon: 'clock', tone: 'warning' },
  { key: 'keeping', label: 'Keeping up', icon: 'eye', tone: 'info' },
  { key: 'clear', label: 'All clear', icon: 'check-circle', tone: 'success' },
];
const WEEK = 7 * 86_400_000;
const stateOf = (r: TeamRow): TeamState =>
  r.approvalsWaiting ? 'blocking'
    : r.overdueReminders || (r.oldestUnreadAt && Date.now() - Date.parse(r.oldestUnreadAt) > WEEK) ? 'behind'
      : r.unread ? 'keeping' : 'clear';
const stuckFor = (iso: string | null) => (iso ? ageTone(iso) : null);
const AVATAR = { danger: 'bg-danger/10 text-on-tint-danger', warning: 'bg-warning/15 text-on-tint-warning', info: 'bg-info/10 text-on-tint-info', success: 'bg-success/[0.12] text-on-tint-success' };
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
/** What Remind fills in, so the owner only presses Save. */
const remindText = (r: TeamRow) =>
  r.approvalsWaiting ? `Decide the ${r.approvalsWaiting} approval${r.approvalsWaiting > 1 ? 's' : ''} waiting on you in My Desk`
    : r.overdueReminders ? `Clear your ${r.overdueReminders} overdue reminder${r.overdueReminders > 1 ? 's' : ''}`
      : `Read your ${r.unread} notification${r.unread > 1 ? 's' : ''} on Vcare`;

export function TeamTab({ rows, onRemind }: { rows: Team | null; onRemind?: (userId: string, title: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = useListParams();
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const counts = STATES.map((s) => ({ ...s, people: rows.filter((r) => stateOf(r) === s.key) }));
  const sub = (s: (typeof counts)[number]) => {
    if (!s.people.length) return 'nobody';
    if (s.key === 'blocking') { const n = s.people.reduce((t, r) => t + r.approvalsWaiting, 0); return `${n} approval${n === 1 ? '' : 's'} stuck`; }
    if (s.key === 'behind') return `${s.people.reduce((n, r) => n + r.unread, 0)} unread`;
    return s.key === 'keeping' ? 'unread, all this week' : 'nothing pending';
  };

  return (
    <SectionCard title="Team follow-up" icon="users" bodyClassName="p-0">
      <div className="border-b border-border px-4 pt-3">
        <KpiStrip columns={4} activeKey={list.get('tm_c')} onSelect={(k) => list.set({ tm_c: k })}
          cards={counts.map((s) => ({ key: s.key, label: s.label, count: s.people.length, icon: s.icon, tone: s.tone, subLabel: sub(s) }))} />
      </div>
      <ListFilter
        rows={rows} paramKey="tm" noun="people"
        placeholder="Person, role, an approval…"
        searchOn={(r) => [r.name, r.role, ...r.approvals.map((a) => a.title)]}
        chipOf={stateOf}
        dates={[
          { key: 'seen', label: 'Last active', of: (r) => r.lastSeenAt },
          { key: 'approval', label: 'Oldest approval', of: (r) => r.oldestApprovalAt },
          { key: 'unread', label: 'Oldest unread', of: (r) => r.oldestUnreadAt },
        ]}
        sorts={[
          { key: 'most', label: 'Most pending', compare: (a, b) => (b.unread + b.overdueReminders * 3 + b.approvalsWaiting * 5) - (a.unread + a.overdueReminders * 3 + a.approvalsWaiting * 5) },
          { key: 'stuck', label: 'Approval stuck longest', compare: oldestBy((r) => r.oldestApprovalAt) },
          { key: 'new', label: 'Recently active', compare: newestBy((r) => r.lastSeenAt) },
          { key: 'old', label: 'Inactive longest', compare: oldestBy((r) => r.lastSeenAt) },
          { key: 'name', label: 'Name A to Z', compare: (a, b) => a.name.localeCompare(b.name) },
        ]}
        selects={[
          { key: 'role', label: 'Role', of: (r) => r.role ?? 'No role', options: uniq(rows.map((r) => r.role ?? 'No role')) },
          { key: 'web', label: 'On the web', of: (r) => (!r.lastSeenAt ? 'Never' : Date.now() - Date.parse(r.lastSeenAt) > WEEK ? 'Not this week' : 'This week'), options: ['This week', 'Not this week', 'Never'] },
        ]}
        exportAs={{ title: 'Team follow-up', columns: [
          { header: 'Person', value: (r) => r.name }, { header: 'Role', value: (r) => r.role ?? '' },
          { header: 'State', value: (r) => STATES.find((s) => s.key === stateOf(r))!.label },
          { header: 'Approvals waiting', value: (r) => r.approvalsWaiting }, { header: 'Oldest approval', value: (r) => r.oldestApprovalAt?.slice(0, 10) ?? '' },
          { header: 'Unread', value: (r) => r.unread }, { header: 'Oldest unread', value: (r) => r.oldestUnreadAt?.slice(0, 10) ?? '' },
          { header: 'Overdue reminders', value: (r) => r.overdueReminders }, { header: 'Last active', value: (r) => r.lastSeenAt?.slice(0, 10) ?? '' },
        ] }}
      >
        {(shown) => shown.length === 0
          ? <EmptyState icon="search" title="Nothing matches" hint="Widen the date range or clear a filter." />
          // Worst state on top whatever the sort; the sort orders people inside each.
          : STATES.map((s) => ({ s, people: shown.filter((r) => stateOf(r) === s.key) })).filter((g) => g.people.length).map(({ s, people }) => (
            <section key={s.key}>
              <p className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>{people.length} {people.length === 1 ? 'person' : 'people'}
              </p>
              <ul>{people.map((r) => (
                <PersonCard key={r.userId} r={r} tone={s.tone} isOpen={open === r.userId}
                  toggle={() => setOpen(open === r.userId ? null : r.userId)}
                  onRemind={onRemind && s.key !== 'clear' ? () => onRemind(r.userId, remindText(r)) : undefined} />
              ))}</ul>
            </section>
          ))}
      </ListFilter>
    </SectionCard>
  );
}

function PersonCard({ r, tone, isOpen, toggle, onRemind }: {
  r: TeamRow; tone: (typeof STATES)[number]['tone']; isOpen: boolean; toggle: () => void; onRemind?: () => void;
}) {
  const approvalAge = stuckFor(r.oldestApprovalAt);
  const unreadAge = stuckFor(r.oldestUnreadAt);
  const kinds = Object.entries(r.unreadByKind).sort((a, b) => b[1] - a[1]);
  const stat = (label: string, n: number, sub: string | null, bad: 'danger' | 'warning' | null) => (
    <div className="min-w-[7.5rem]">
      <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono text-lg font-semibold tabular-nums ${!n ? 'text-muted-foreground' : bad === 'danger' ? 'text-danger' : bad === 'warning' ? 'text-on-tint-warning' : ''}`}>{n}</p>
      {n > 0 && sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex min-w-[13rem] flex-1 items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${AVATAR[tone]}`}>{initials(r.name)}</span>
          <div className="min-w-0">
            <p className="font-medium">{r.name}</p>
            <p className="text-xs text-muted-foreground">{r.role ?? 'No role'} · {r.lastSeenAt ? `on the web ${ago(r.lastSeenAt)}` : 'never on the web'}</p>
            {kinds.length > 0 && (
              <p className="mt-1.5 flex flex-wrap gap-1">
                {kinds.slice(0, 4).map(([k, n]) => (
                  <Badge key={k} tone={NOTE_KINDS[k]?.tone ?? 'neutral'} icon={NOTE_KINDS[k]?.icon} title={`${n} unread: ${NOTE_KINDS[k]?.label ?? k}`}>
                    {n} {NOTE_KINDS[k]?.label ?? k}
                  </Badge>
                ))}
              </p>
            )}
          </div>
        </div>
        {stat('Approvals with them', r.approvalsWaiting, r.oldestApprovalAt && `oldest ${ago(r.oldestApprovalAt)}`, approvalAge ?? 'warning')}
        {stat('Unread', r.unread, r.oldestUnreadAt && `oldest ${ago(r.oldestUnreadAt)}`, unreadAge)}
        {stat('Reminders overdue', r.overdueReminders, null, 'warning')}
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          {r.approvals.length > 0 && (
            <Button size="sm" icon={isOpen ? 'chevron-up' : 'chevron-down'} aria-expanded={isOpen} onClick={toggle}>
              {isOpen ? 'Hide' : 'See'} approvals
            </Button>
          )}
          {onRemind && <Button size="sm" variant="primary" icon="bell" onClick={onRemind}>Remind</Button>}
        </div>
      </div>
      {isOpen && (
        <ul className="mx-4 mb-3 divide-y divide-border rounded-lg border border-border bg-muted/20">
          {r.approvals.map((a) => {
            const c = categoryOf(a.type);
            const age = ageTone(a.since);
            return (
              <li key={a.requestId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                <Badge tone={c.tone} icon={c.icon}>{a.typeLabel}</Badge>
                <span className="font-medium">{a.title}</span>
                <span className="text-muted-foreground">
                  from {a.requesterName}{a.amountPaise ? ` · ₹${(a.amountPaise / 100).toLocaleString('en-IN')}` : ''} · <span className={age === 'danger' ? 'font-semibold text-danger' : age === 'warning' ? 'font-semibold text-on-tint-warning' : ''}>raised {ago(a.since)}</span>
                </span>
                <Link href={a.href} className="ms-auto font-medium text-brand hover:underline">Open</Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
