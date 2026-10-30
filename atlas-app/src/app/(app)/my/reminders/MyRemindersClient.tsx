'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { ListFilter } from '@/components/ui/ListFilter';
import {
  addReminderAction, decideAction, inboxAction, markReadAction, myChannelsAction, reminderAction, saveMyChannelsAction,
} from '@/app/actions/inbox';
import type { InboxItem } from '@/server/approvals';
import { deskAction, raiseDeskAction, reminderTargetsAction, teamFollowUpAction } from '@/app/actions/inbox';
import { MyRequestsTab, NewRequestModal, TeamTab, newestBy, oldestBy, uniq, type Desk } from './DeskParts';
import { notificationsAction } from '@/app/actions/inbox';

// Module-level so React calls it once per mount (a new message), not on every render.
const scrollIntoView = (el: HTMLElement | null) => { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
import type { DateRange } from '@/lib/date-ranges';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { useListParams } from '@/components/ui/useListParams';
import { DESK_CATEGORIES, NOTE_KINDS, ageTone, categoryOf } from '@/lib/desk-categories';

/**
 * My Desk (was My Reminders & Requests; renamed and extended 27 Sep 2026,
 * streamline roadmap S2). "New request" is always one click away. Tabs:
 *  - Waiting on me: approve / reject right here (a reason is required to
 *    reject), one by one or several at once; Open for the full record.
 *  - Reminders: personal reminders (+ Add), grouped Overdue / Today / This
 *    week / Later, with Done and Snooze.
 *  - My requests: every request I raised (leave, WFH, comp-off, claims,
 *    assets, resignation) from each module's own table - see DeskParts.
 *  - Team (owner): who has unread notifications, overdue reminders or
 *    approvals sitting with them.
 *  - Notifications: history, plus which ones reach me by push / email.
 */
type Inbox = Awaited<ReturnType<typeof inboxAction>>;
type Tab = 'waiting' | 'reminders' | 'requests' | 'notifications' | 'team';

const rupees = (p: number | null) => (p === null ? '' : `₹${(p / 100).toLocaleString('en-IN')}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const waited = (iso: string) => {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h` : `${Math.floor(h / 24)} days`;
};
const AGE_BUCKETS = ['Over 7 days', '2 to 7 days', 'Under 2 days'];
const ageBucket = (i: InboxItem) => { const t = ageTone(i.since); return t === 'danger' ? AGE_BUCKETS[0] : t === 'warning' ? AGE_BUCKETS[1] : AGE_BUCKETS[2]; };
const AGE_TEXT = { danger: 'font-semibold text-danger', warning: 'font-semibold text-on-tint-warning' };
const AGE_EDGE = { danger: 'border-s-4 border-s-danger', warning: 'border-s-4 border-s-warning' };

export function MyRemindersClient({ initialTab, isOwner, singleStore }: { initialTab: string; isOwner: boolean; singleStore: boolean }) {
  const [tab, setTabState] = useState<Tab>((['waiting', 'reminders', 'requests', 'notifications', 'team'].includes(initialTab) ? initialTab : 'waiting') as Tab);
  /**
   * The tab goes in the address too (9 Oct 2026). Each tab's filters already
   * live there, so a saved View or a shared link reopened the filters on the
   * wrong tab. Replaced, not pushed: switching tabs is not a page to go Back
   * to, and no server round trip - the filters read the live address
   * (useListParams), so they keep it.
   */
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      const next = new URLSearchParams(window.location.search);
      next.set('tab', t);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${next}`);
    } catch { /* history unavailable: the tab still switches */ }
  };
  const [data, setData] = useState<Inbox | null>(null);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [team, setTeam] = useState<Awaited<ReturnType<typeof teamFollowUpAction>> | null>(null);
  const [asking, setAsking] = useState(false);
  const [reminding, setReminding] = useState<{ forUserId: string; title: string } | null>(null);
  // An owner sees everyone's pending items by default (4 Oct 2026). Until then
  // this was hard-coded off, so an owner only saw someone else's request after
  // it had sat for 48 hours and escalated - and could not see their own at all.
  const [everyone, setEveryone] = useState(isOwner);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(() => { inboxAction(everyone).then(setData).catch(() => setMsg({ tone: 'err', text: 'Could not load. Refresh the page.' })); }, [everyone]);
  useEffect(() => { load(); }, [load]);
  const loadDesk = useCallback(() => { deskAction().then(setDesk).catch(() => undefined); }, []);
  useEffect(() => { loadDesk(); }, [loadDesk]);
  useEffect(() => { if (tab === 'team' && isOwner) teamFollowUpAction().then(setTeam).catch(() => undefined); }, [tab, isOwner]);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>, okText?: string) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ tone: 'err', text: r.error });
      else { if (r.message || okText) setMsg({ tone: 'ok', text: r.message ?? okText! }); load(); loadDesk(); }
    });
  };

  const counts = {
    waiting: data?.waiting.length ?? 0,
    reminders: data?.reminders.filter((r) => Date.parse(r.snoozedUntil ?? r.dueAt) <= Date.now() + 86_400_000).length ?? 0,
    requests: desk?.requests.filter((r) => r.status === 'pending').length ?? 0,
    notifications: data?.notifications.unread ?? 0,
    team: 0,
  };

  return (
    <div>
      <PageHeader badge="MD" title="My Desk" subtitle="Ask for leave or anything else, see what waits on you, your reminders and notifications"
        actions={<Button variant="primary" icon="plus" onClick={() => setAsking(true)}>New request</Button>} />
      {msg && (
        // Scrolled to when it appears: an Approve far down the list used to fail
        // with this banner off screen, and looked like nothing happened (30 Oct 2026).
        <div ref={scrollIntoView} key={msg.text}>
          <Card className={`mb-3 p-3 text-sm ${msg.tone === 'err' ? 'border-danger/40 bg-danger/5 text-danger' : 'border-success/40 bg-success/5 text-success'}`}>
            <span role={msg.tone === 'err' ? 'alert' : 'status'}>{msg.text}</span>
          </Card>
        </div>
      )}

      <nav aria-label="Sections" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {([
          ['waiting', 'Waiting on me'], ['requests', 'My requests'], ['reminders', 'Reminders'], ['notifications', 'Notifications'],
          ...(isOwner ? [['team', 'Team follow-up']] : []),
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded px-4 py-1.5 text-sm ${tab === key ? 'bg-brand/10 font-semibold text-brand' : 'hover:bg-muted'}`}>
            {label}
            {counts[key] > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{counts[key]}</span>}
          </button>
        ))}
      </nav>

      {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          {tab === 'waiting' && (
            <WaitingTab items={data.waiting} isOwner={isOwner} everyone={everyone} setEveryone={setEveryone} busy={pending}
              decide={(i, d, note) => run(() => decideAction(i.type, i.entityId, d, note), d === 'approved' ? 'Approved.' : 'Rejected.')} />
          )}
          {tab === 'reminders' && (
            <RemindersTab reminders={data.reminders} busy={pending} singleStore={singleStore}
              act={(id, op, until) => run(() => reminderAction(id, op, until))}
              add={(input) => run(() => addReminderAction(input), 'Reminder added.')} />
          )}
          {tab === 'requests' && <MyRequestsTab desk={desk} approvals={data.requests} onNew={() => setAsking(true)} />}
          {tab === 'team' && isOwner && <TeamTab rows={team} onRemind={singleStore ? (forUserId, title) => setReminding({ forUserId, title }) : undefined} />}
          {tab === 'notifications' && (
            <NotificationsTab data={data.notifications} singleStore={singleStore}
              markAll={() => run(() => markReadAction('all'))} />
          )}
        </>
      )}

      {reminding && (
        <AddReminder preset={reminding} onClose={() => setReminding(null)}
          onSave={(v) => { setReminding(null); run(() => addReminderAction(v), 'Reminder sent. It rings on their phone at that time.'); }} />
      )}
      {asking && (
        <NewRequestModal options={desk?.options ?? null} singleStore={singleStore} busy={pending} onClose={() => setAsking(false)}
          onSend={(input) => {
            setMsg(null);
            start(async () => {
              const r = await raiseDeskAction(input);
              if (r.error) { setMsg({ tone: 'err', text: r.error }); return; }
              setMsg({ tone: 'ok', text: r.message ?? 'Request sent.' });
              setAsking(false); setTab('requests'); load(); loadDesk();
            });
          }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Waiting on me

function WaitingTab({ items, isOwner, everyone, setEveryone, decide, busy }: {
  items: InboxItem[]; isOwner: boolean; everyone: boolean; setEveryone: (v: boolean) => void; busy: boolean;
  decide: (i: InboxItem, d: 'approved' | 'rejected', note: string | null) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<InboxItem[] | null>(null);
  const [approving, setApproving] = useState<InboxItem | null>(null);
  const key = (i: InboxItem) => `${i.type}:${i.entityId}`;
  const chosen = items.filter((i) => picked.includes(key(i)));
  // The category strip is the chip filter of the list below (same `q_c` address key).
  const list = useListParams();
  const cats = DESK_CATEGORIES.map((c) => {
    const mine = items.filter((i) => categoryOf(i.type).key === c.key);
    const oldest = mine[0] && mine.reduce((a, b) => (a.since < b.since ? a : b)).since;
    return { ...c, count: mine.length, oldest };
  }).filter((c) => c.count > 0 || c.key !== 'other');

  return (
    <SectionCard title="Waiting on me" icon="check-circle" bodyClassName="p-0"
      action={isOwner ? (
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          Everyone&apos;s pending items
        </label>
      ) : undefined}>
      {items.length === 0 ? (
        <EmptyState icon="check-circle" title="Nothing waiting on you" hint="New requests that need your decision appear here, newest first." />
      ) : (
        <>
        <div className="border-b border-border px-4 pt-3">
          <KpiStrip columns={6} activeKey={list.get('q_c')} onSelect={(k) => list.set({ q_c: k })}
            cards={cats.map((c) => ({
              key: c.key, label: c.label, count: c.count, icon: c.icon,
              tone: c.tone === 'neutral' ? 'default' : c.tone,
              subLabel: c.oldest ? `oldest ${waited(c.oldest)}` : 'nothing waiting',
            }))} />
        </div>
        <ListFilter
          exportAs={{ title: 'Waiting on me', columns: [
            { header: 'What', value: (r) => r.title }, { header: 'Type', value: (r) => r.typeLabel },
            { header: 'Asked by', value: (r) => r.requesterName }, { header: 'Since', value: (r) => r.since.slice(0, 10) },
            { header: 'Amount (Rs)', value: (r) => (r.amountPaise != null ? r.amountPaise / 100 : '') },
            { header: 'Details', value: (r) => r.summary }, { header: 'Stuck with', value: (r) => r.waitingOnNames.join(', ') },
          ] }}
          rows={items}
          noun="requests"
          placeholder="Who asked, what for, amount…"
          searchOn={(i) => [i.title, i.requesterName, i.typeLabel, i.summary, i.amountPaise ? rupees(i.amountPaise) : null, ...i.waitingOnNames]}
          chipOf={(i) => categoryOf(i.type).key}
          dates={[{ key: 'raised', label: 'Raised on', of: (i) => i.since }]}
          sorts={[
            { key: 'new', label: 'Newest first', compare: newestBy((i) => i.since) },
            { key: 'old', label: 'Oldest first (waiting longest)', compare: oldestBy((i) => i.since) },
            { key: 'amt', label: 'Amount: high to low', compare: (a, b) => (b.amountPaise ?? -1) - (a.amountPaise ?? -1) },
            { key: 'amtl', label: 'Amount: low to high', compare: (a, b) => (a.amountPaise ?? Infinity) - (b.amountPaise ?? Infinity) },
            { key: 'who', label: 'Asked by A to Z', compare: (a, b) => a.requesterName.localeCompare(b.requesterName) },
          ]}
          selects={[
            { key: 'type', label: 'Request type', of: (i) => i.typeLabel, options: uniq(items.map((i) => i.typeLabel)) },
            { key: 'age', label: 'Waiting', of: ageBucket, options: AGE_BUCKETS },
            { key: 'by', label: 'Asked by', of: (i) => i.requesterName, options: uniq(items.map((i) => i.requesterName)) },
            { key: 'with', label: 'Stuck with', of: (i) => i.waitingOnNames[0] ?? 'Owner / admins', options: uniq(items.map((i) => i.waitingOnNames[0] ?? 'Owner / admins')) },
          ]}
          amountOf={(i) => (i.amountPaise == null ? null : i.amountPaise / 100)}
        >
          {(shown) => (
            shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search or the type filter to see everything waiting on you." />
            ) : (
              <WaitingList
                items={shown} picked={picked} setPicked={setPicked}
                chosen={chosen} decide={decide} busy={busy} setRejecting={setRejecting} setApproving={setApproving}
              />
            )
          )}
        </ListFilter>
        </>
      )}
      {approving && (
        <ApproveNoteDialog item={approving} onClose={() => setApproving(null)}
          onApprove={(note) => { decide(approving, 'approved', note); setApproving(null); setPicked((p) => p.filter((k) => k !== key(approving))); }} />
      )}
      {rejecting && (
        <RejectDialog count={rejecting.length} onClose={() => setRejecting(null)}
          onReject={(note) => { rejecting.forEach((i) => decide(i, 'rejected', note)); setRejecting(null); setPicked([]); }} />
      )}
    </SectionCard>
  );
}

/** The rows themselves - split out so `ListFilter` wraps only the list. */
function WaitingList({ items, picked, setPicked, chosen, decide, busy, setRejecting, setApproving }: {
  items: InboxItem[];
  picked: string[];
  setPicked: React.Dispatch<React.SetStateAction<string[]>>;
  chosen: InboxItem[];
  decide: (i: InboxItem, d: 'approved' | 'rejected', note: string | null) => void;
  busy: boolean;
  setRejecting: (items: InboxItem[]) => void;
  setApproving: (item: InboxItem) => void;
}) {
  const key = (i: InboxItem) => `${i.type}:${i.entityId}`;
  // Items that need a note (a call-back) are approved one by one, never in bulk.
  const needNote = chosen.filter((i) => i.noteToApprove);

  return (
        <>
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
              <span className="font-medium">{chosen.length} selected</span>
              <Button size="sm" variant="primary" disabled={busy || needNote.length === chosen.length}
                onClick={() => { chosen.filter((i) => !i.noteToApprove).forEach((i) => decide(i, 'approved', null)); setPicked(needNote.map(key)); }}>Approve all</Button>
              <Button size="sm" disabled={busy} onClick={() => setRejecting(chosen)}>Reject all</Button>
              {needNote.length > 0 && <span className="text-on-tint-warning">{needNote.length} need a note of your call - approve {needNote.length === 1 ? 'it' : 'them'} one by one.</span>}
            </div>
          )}
          {/* One list in the chosen sort (30 Oct 2026: category blocks put the newest
              request under older ones); the strip above filters by category. */}
          <section>
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
            <span className="text-xs text-muted-foreground">{items.length} waiting</span>
            <button type="button" className="ms-auto text-xs font-medium text-brand hover:underline"
              onClick={() => setPicked((p) => [...new Set([...p, ...items.map(key)])])}>Select all {items.length}</button>
          </div>
          <ul>
            {items.map((i) => {
              const c = categoryOf(i.type);
              const age = ageTone(i.since);
              return (
              <li key={key(i)} className={`flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 ${age ? AGE_EDGE[age] : ''}`}>
                <input type="checkbox" className="mt-1" aria-label={`Select ${i.title}`} checked={picked.includes(key(i))}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, key(i)] : p.filter((x) => x !== key(i))))} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {i.title}
                    <Badge tone={c.tone} icon={c.icon}>{i.typeLabel}</Badge>
                    {i.levels && i.levels > 1 && <Badge tone="info">Level {i.level} of {i.levels}</Badge>}
                    {i.raisedByMe && <Badge tone="warning">You raised this</Badge>}
                    {i.asOwner && !i.raisedByMe && <Badge tone="warning">Admin view</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {/* '-' = no creator saved (records brought over from the old system). */}
                    Raised by {i.requesterName === '-' ? 'not recorded' : i.requesterName} · <span className={age ? AGE_TEXT[age] : ''}>waiting {waited(i.since)}</span>{i.summary ? ` · ${i.summary}` : ''}{i.amountPaise ? ` · ${rupees(i.amountPaise)}` : ''}
                  </p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">Stuck with </span>
                    <span className="font-medium">{i.waitingOnNames.length ? i.waitingOnNames.join(' or ') : 'Owner / admins'}</span>
                    {i.asOwner && <span className="text-muted-foreground"> · approving it yourself is recorded as an admin override</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Link href={i.href} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted">Open</Link>
                  <Button size="sm" disabled={busy} onClick={() => setRejecting([i])}>Reject</Button>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => (i.noteToApprove ? setApproving(i) : decide(i, 'approved', null))}>Approve</Button>
                </div>
              </li>
              );
            })}
          </ul>
          </section>
        </>
  );
}

/** Approve with the note the approval needs - InboxItem.noteToApprove (30 Oct 2026). */
function ApproveNoteDialog({ item, onClose, onApprove }: { item: InboxItem; onClose: () => void; onApprove: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal title={`Approve: ${item.title}`} icon="check-circle" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!note.trim()} onClick={() => onApprove(note.trim())}>Approve</Button></>}>
      <Field label={item.noteToApprove ?? 'Note'} required htmlFor="approve-note" hint="Kept on the job.">
        <textarea id="approve-note" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
      </Field>
    </Modal>
  );
}

function RejectDialog({ count, onClose, onReject }: { count: number; onClose: () => void; onReject: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal title={count > 1 ? `Reject ${count} requests` : 'Reject request'} icon="x-circle" tone="danger" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!note.trim()} onClick={() => onReject(note.trim())}>Reject</Button></>}>
      <Field label="Reason" required htmlFor="reject-note" hint="The person who asked sees this.">
        <textarea id="reject-note" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ Reminders

type ReminderRow = Inbox['reminders'][number];

function RemindersTab({ reminders, act, add, busy, singleStore }: {
  reminders: ReminderRow[]; busy: boolean; singleStore: boolean;
  act: (id: string, op: 'done' | 'delete' | 'snooze', until?: string) => void;
  add: (input: { title: string; note: string | null; dueAt: string; repeat: string; forUserId?: string | null }) => void;
}) {
  const [adding, setAdding] = useState(false);
  /**
   * Which group a reminder falls in. Worked out once per row so the chips,
   * the filter and the grouping below all agree on the same answer.
   */
  const groupOf = useMemo(() => {
    const now = Date.now();
    const endToday = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T23:59:59+05:30').getTime();
    const week = now + 7 * 86_400_000;
    return (r: ReminderRow) => {
      const at = Date.parse(r.snoozedUntil ?? r.dueAt);
      return at < now ? 'Overdue' : at <= endToday ? 'Today' : at <= week ? 'This week' : 'Later';
    };
  }, []);
  const GROUPS = ['Overdue', 'Today', 'This week', 'Later'];
  const due = (r: ReminderRow) => r.snoozedUntil ?? r.dueAt;
  const repeatLabel = (r: ReminderRow) => (r.repeat === 'none' ? 'Does not repeat' : r.repeat[0].toUpperCase() + r.repeat.slice(1));
  const snooze = (id: string, hours: number) => act(id, 'snooze', new Date(Date.now() + hours * 3_600_000).toISOString());

  return (
    <SectionCard title="Reminders" icon="clock" bodyClassName="p-0"
      action={singleStore ? <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>Add reminder</Button> : undefined}>
      <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        Your own reminders. Renewals, approvals and due dates reach you as notifications - see the bell or the Notifications tab.
      </p>
      {reminders.length === 0 ? (
        <EmptyState icon="clock" title="No reminders" hint={'Add one - "Call Sharma ji Monday 11 am", repeating weekly if you like.'} />
      ) : (
        <ListFilter
          rows={reminders} paramKey="rm" noun="reminders"
          placeholder="Reminder, note…"
          searchOn={(r) => [r.title, r.note]}
          chips={GROUPS.map((g) => ({ value: g, label: g, count: reminders.filter((r) => groupOf(r) === g).length }))}
          chipOf={groupOf} chipLabel="When"
          dates={[
            { key: 'due', label: 'Due on', of: due, future: true },
            { key: 'created', label: 'Created on', of: (r) => r.createdAt },
          ]}
          sorts={[
            { key: 'new', label: 'Newest first', compare: newestBy(due) },
            { key: 'old', label: 'Oldest first', compare: oldestBy(due) },
            { key: 'created', label: 'Recently created', compare: newestBy((r) => r.createdAt) },
            { key: 'title', label: 'Title A to Z', compare: (a, b) => a.title.localeCompare(b.title) },
          ]}
          selects={[
            { key: 'rep', label: 'Repeats', of: repeatLabel, options: uniq(reminders.map(repeatLabel)) },
            { key: 'from', label: 'Set by', of: (r) => (r.byOther ? 'My manager' : 'Me'), options: ['Me', 'My manager'] },
          ]}
          exportAs={{ title: 'My reminders', columns: [
            { header: 'Reminder', value: (r) => r.title }, { header: 'Due', value: (r) => due(r).slice(0, 16).replace('T', ' ') },
            { header: 'When', value: groupOf }, { header: 'Repeats', value: repeatLabel }, { header: 'Note', value: (r) => r.note ?? '' },
          ] }}
        >
          {(shown) => shown.length === 0
            ? <EmptyState icon="search" title="Nothing matches" hint="Widen the date range or clear a filter." />
            // Groups stay in their own order - Overdue always on top - and the
            // chosen sort orders the reminders inside each one.
            : GROUPS.map((label) => ({ label, rows: shown.filter((r) => groupOf(r) === label) })).filter((g) => g.rows.length).map((g) => (
        <div key={g.label}>
          <p className={`border-b border-border px-4 py-1.5 text-micro font-semibold uppercase tracking-wide ${g.label === 'Overdue' ? 'text-danger' : 'text-muted-foreground'}`}>{g.label}</p>
          {g.rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}{r.repeat !== 'none' && <Badge tone="neutral" className="ms-1.5">{r.repeat}</Badge>}{r.byOther && <Badge tone="info" className="ms-1.5">from your manager</Badge>}</p>
                <p className="text-xs text-muted-foreground">{when(r.snoozedUntil ?? r.dueAt)}{r.snoozedUntil ? ' (snoozed)' : ''}{r.note ? ` · ${r.note}` : ''}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <select aria-label="Snooze" disabled={busy} defaultValue="" onChange={(e) => { if (e.target.value) snooze(r.id, Number(e.target.value)); e.target.value = ''; }}
                  className="h-7 rounded-lg border border-border bg-card px-1.5 text-xs">
                  <option value="">Snooze…</option>
                  <option value="1">1 hour</option>
                  <option value="24">Tomorrow</option>
                  <option value="168">Next week</option>
                </select>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => act(r.id, 'done')}>Done</Button>
                <button type="button" aria-label="Delete" title="Delete" disabled={busy} onClick={() => act(r.id, 'delete')} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
        </ListFilter>
      )}
      {adding && <AddReminder onClose={() => setAdding(false)} onSave={(v) => { add(v); setAdding(false); }} />}
    </SectionCard>
  );
}

function AddReminder({ onClose, onSave, preset }: {
  onClose: () => void; onSave: (v: { title: string; note: string | null; dueAt: string; repeat: string; forUserId: string | null }) => void;
  /** Team follow-up's Remind: the person and the words filled in. */
  preset?: { forUserId: string; title: string };
}) {
  // Decision 12 (13 Oct 2026): yourself always; a manager their team; the owner anybody.
  const [targets, setTargets] = useState<{ id: string; name: string; self: boolean }[]>([]);
  const [forUserId, setForUserId] = useState(preset?.forUserId ?? '');
  useEffect(() => { reminderTargetsAction().then(setTargets).catch(() => undefined); }, []);
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [title, setTitle] = useState(preset?.title ?? '');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState('10:00');
  const [repeat, setRepeat] = useState('none');
  return (
    <Modal title="Add reminder" icon="clock" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim() || !date}
        onClick={() => onSave({ title, note: note || null, dueAt: new Date(`${date}T${time || '09:00'}:00+05:30`).toISOString(), repeat, forUserId: forUserId || null })}>Save</Button></>}>
      <div className="grid gap-3">
        {targets.length > 1 && (
          <Field label="For" htmlFor="rem-for" hint="On Vcare it rings full screen on their phone at that time, even when the phone is locked.">
            <select id="rem-for" value={forUserId} onChange={(e) => setForUserId(e.target.value)} className="field-input">
              {targets.map((t) => <option key={t.id} value={t.self ? '' : t.id}>{t.self ? 'Me' : t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={forUserId ? 'Remind them to' : 'Remind me to'} required htmlFor="rem-title">
          <input id="rem-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call Sharma ji about the AMC" className="field-input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required htmlFor="rem-date"><input id="rem-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field-input" /></Field>
          <Field label="Time" htmlFor="rem-time"><input id="rem-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field-input" /></Field>
        </div>
        <Field label="Repeat" htmlFor="rem-repeat">
          <select id="rem-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className="field-input">
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </Field>
        <Field label="Note" htmlFor="rem-note"><textarea id="rem-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="field-input" /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Notifications

const KINDS: [string, string][] = Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.label]);

function NotificationsTab({ data, markAll, singleStore }: { data: Inbox['notifications']; markAll: () => void; singleStore: boolean }) {
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof myChannelsAction>>>(null);
  const [saved, setSaved] = useState(false);
  /**
   * OLDER NOTIFICATIONS (9 Oct 2026). The tab arrives with the newest 100.
   * Picking a date range asks the server for THAT window (up to 500), so
   * "Last month" shows last month rather than whichever of the newest 100
   * happened to fall in it. Back to All time, back to the newest 100.
   */
  const [ranged, setRanged] = useState<Inbox['notifications']['rows'] | null>(null);
  const [fetching, setFetching] = useState(false);
  const onRange = useCallback((r: DateRange) => {
    if (!r.from && !r.to) { setRanged(null); return; }
    setFetching(true);
    notificationsAction(r.from?.toISOString() ?? null, r.to?.toISOString() ?? null)
      .then((res) => setRanged(res.rows))
      .catch(() => setRanged(null))
      .finally(() => setFetching(false));
  }, []);
  const rows = ranged ?? data.rows;
  const kindLabel = (k: string) => KINDS.find(([key]) => key === k)?.[1] ?? 'Other';
  useEffect(() => { if (singleStore) void myChannelsAction().then(setPrefs); }, [singleStore]);
  const value = (kind: string, ch: 'push' | 'email') => {
    const mine = prefs?.mine[kind as keyof typeof prefs.mine]?.[ch];
    return mine ?? prefs?.business[kind as keyof typeof prefs.business]?.[ch] ?? false;
  };
  const toggle = (kind: string, ch: 'push' | 'email', v: boolean) => {
    if (!prefs) return;
    const cur = prefs.mine[kind as keyof typeof prefs.mine] ?? { push: value(kind, 'push'), email: value(kind, 'email') };
    const mine = { ...prefs.mine, [kind]: { ...cur, [ch]: v } };
    setPrefs({ ...prefs, mine });
    setSaved(false);
    void saveMyChannelsAction(mine).then(() => setSaved(true));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <SectionCard title="Notifications" icon="alert-circle" bodyClassName="p-0"
        action={data.unread > 0 ? <button type="button" onClick={markAll} className="text-xs font-medium text-brand hover:underline">Mark all read</button> : undefined}>
        {data.rows.length === 0 ? <EmptyState icon="alert-circle" title="No notifications yet" /> : (
          <ListFilter
            rows={rows} paramKey="nt" noun="notifications"
            placeholder="Title, details…"
            searchOn={(n) => [n.title, n.body]}
            chips={uniq(rows.map((n) => kindLabel(n.kind))).map((k) => ({ value: k, label: k, count: rows.filter((n) => kindLabel(n.kind) === k).length }))}
            chipOf={(n) => kindLabel(n.kind)} chipLabel="Kind"
            dates={[{ key: 'got', label: 'Received on', of: (n) => n.createdAt }]}
            onRange={onRange}
            sorts={[
              { key: 'new', label: 'Newest first', compare: newestBy((n) => n.createdAt) },
              { key: 'old', label: 'Oldest first', compare: oldestBy((n) => n.createdAt) },
              { key: 'unread', label: 'Unread first', compare: (a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || newestBy<typeof a>((n) => n.createdAt)(a, b) },
            ]}
            selects={[{ key: 'rd', label: 'Read', of: (n) => (n.readAt ? 'Read' : 'Unread'), options: ['Unread', 'Read'] }]}
            exportAs={{ title: 'My notifications', columns: [
              { header: 'Title', value: (n) => n.title }, { header: 'Kind', value: (n) => kindLabel(n.kind) },
              { header: 'Received', value: (n) => n.createdAt.slice(0, 16).replace('T', ' ') },
              { header: 'Read', value: (n) => (n.readAt ? 'Read' : 'Unread') }, { header: 'Details', value: (n) => n.body ?? '' },
            ] }}
          >
            {(shown) => (
              <>
                {fetching && <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">Fetching that period…</p>}
                {!ranged && data.rows.length >= 100 && (
                  <p className="border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                    The newest 100. Pick a date range above to see older ones.
                  </p>
                )}
                {shown.length === 0 ? <EmptyState icon="search" title="Nothing matches" hint="Widen the date range or clear a filter." /> : (
                  <ul>
                    {shown.map((n) => (
                      <li key={n.id} className={`border-b border-border px-4 py-2.5 last:border-0 ${n.readAt ? '' : 'bg-brand/5'}`}>
                        <Link href={n.href ?? '/my/reminders'} className="block hover:underline">
                          <p className="text-sm font-medium">{n.title}</p>
                        </Link>
                        {n.body && <p className="whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge tone={NOTE_KINDS[n.kind]?.tone ?? 'neutral'} icon={NOTE_KINDS[n.kind]?.icon}>{kindLabel(n.kind)}</Badge>
                          {when(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </ListFilter>
        )}
      </SectionCard>
      {singleStore && prefs && (
        <SectionCard title="How they reach me" icon="settings" className="lg:self-start">
          <p className="mb-2 text-xs text-muted-foreground">The bell always shows everything. Choose what also comes as a phone notification or an email.</p>
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="py-1 text-start font-medium">Kind</th><th className="font-medium">Phone</th><th className="font-medium">Email</th></tr></thead>
            <tbody>
              {KINDS.map(([k, label]) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1.5">{label}</td>
                  <td className="text-center"><input type="checkbox" aria-label={`${label} on phone`} checked={value(k, 'push')} onChange={(e) => toggle(k, 'push', e.target.checked)} /></td>
                  <td className="text-center"><input type="checkbox" aria-label={`${label} by email`} checked={value(k, 'email')} onChange={(e) => toggle(k, 'email', e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {saved && <p className="mt-2 text-xs text-success">Saved.</p>}
        </SectionCard>
      )}
    </div>
  );
}
