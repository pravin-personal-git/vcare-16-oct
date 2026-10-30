'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard, Segmented } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Modal } from '@/components/ui/Modal';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import { useListParams } from '@/components/ui/useListParams';
import { FilePicker, Thread, uploadFiles, type ThreadComment } from '@/components/helpdesk/Thread';
import {
  raiseTicketAction, addCommentAction, setStatusAction, sendToSupportAction,
  fetchCommentsAction, assignTicketAction, fetchAssignableUsersAction,
  createCategoryAction, removeCategoryAction,
} from './actions';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

interface TicketRow {
  id: string;
  ticketNo: string;
  raisedById: string;
  raisedByName: string;
  categoryId: string | null;
  categoryName: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  commentCount: number;
  toSupport: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  openTicketCount: number;
}

interface Dashboard {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unassigned: number;
  mineOpen: number;
}

const STATUS_TONE = {
  open: 'warning', in_progress: 'info', resolved: 'success', closed: 'neutral',
} as const;
const STATUS_LABEL = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed',
} as const;
const PRIORITY_TONE = {
  low: 'neutral', normal: 'brand', high: 'warning', urgent: 'danger',
} as const;

const NEXT_STEPS: { value: TicketStatus; label: string; requiresManage: boolean }[] = [
  { value: 'in_progress', label: 'Start work', requiresManage: true },
  { value: 'resolved', label: 'Mark resolved', requiresManage: true },
  { value: 'closed', label: 'Close', requiresManage: true },
  { value: 'open', label: 'Reopen', requiresManage: false },
];

// Mirrors the transition graph in src/server/helpdesk.ts - the button list
// must never offer a move the server will refuse.
const ALLOWED_NEXT: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function HelpdeskClient({
  tickets, categories, dashboard, currentUserId, canViewAll, canManage, listPage, statusFilter: statusParam, mineOnly,
}: {
  /** One server-side page (F1b): status, mine, search and page run on the server. */
  listPage: CardListPage;
  statusFilter: string;
  mineOnly: boolean;
  tickets: TicketRow[];
  categories: CategoryRow[];
  dashboard: Dashboard;
  currentUserId: string;
  canViewAll: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const list = useListParams();
  const statusFilter = statusParam as 'all' | TicketStatus;
  const setStatusFilter = (v: 'all' | TicketStatus) => list.set({ status: v === 'all' ? null : v });
  const setMineOnly = (v: boolean) => list.set({ mine: v ? '1' : null });
  const [raising, setRaising] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [openTicket, setOpenTicket] = useState<TicketRow | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);


  async function act(key: string, fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  const kpis: KpiCard[] = [
    { key: 'open', label: 'Open', count: dashboard.open, icon: 'alert-circle', tone: dashboard.open > 0 ? 'warning' : 'default' },
    { key: 'progress', label: 'In Progress', count: dashboard.inProgress, icon: 'clock', tone: 'info' },
    { key: 'unassigned', label: 'Unassigned', count: dashboard.unassigned, icon: 'user-plus', tone: dashboard.unassigned > 0 ? 'danger' : 'default' },
    { key: 'mine', label: 'My Open Tickets', count: dashboard.mineOpen, icon: 'user', tone: 'default' },
  ];

  return (
    <div>
      <PageHeader
        badge="HD"
        title="Helpdesk"
        subtitle={canViewAll ? "Every ticket raised in this store" : 'Tickets you’ve raised'}
        actions={
          <div className="flex gap-2">
            {canManage && (
              <Button variant="outline" iconEnd="sliders" onClick={() => setManagingCategories(true)}>Categories</Button>
            )}
            <Button variant="primary" iconEnd="plus" onClick={() => setRaising(true)}>Raise a ticket</Button>
          </div>
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          options={[
            { value: 'all', label: `All (${listPage.total})` },
            { value: 'open', label: STATUS_LABEL.open },
            { value: 'in_progress', label: STATUS_LABEL.in_progress },
            { value: 'resolved', label: STATUS_LABEL.resolved },
            { value: 'closed', label: STATUS_LABEL.closed },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        {canViewAll && (
          <Segmented
            options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Raised by me' }]}
            value={mineOnly ? 'mine' : 'all'}
            onChange={(v) => setMineOnly(v === 'mine')}
          />
        )}
      </div>

      <SectionCard title={`${listPage.server.total} ticket${listPage.server.total === 1 ? '' : 's'}`} icon="alert-circle" bodyClassName="p-0">
        {listPage.server.total === 0 ? (
          <EmptyState icon="alert-circle" title="No tickets here" hint="Raise one to ask IT, HR or Facilities for help." />
        ) : (
          /* F1b / D17. A helpdesk queue is worked, not browsed - "that ticket
             about the printer", "everything sitting with Prachi". Ticket
             number, subject, who raised it and who holds it are the handles. */
          <ListFilter
            server={listPage.server}
            exportScreen="helpdesk"
            rows={tickets}
            // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
            dates={[{ key: 'raised', label: 'Raised on', of: (r) => r.createdAt }, { key: 'resolved', label: 'Resolved on', of: (r) => r.resolvedAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
            noun="tickets"
            placeholder="Ticket no, subject, who raised it, who holds it…"
            searchOn={(t) => [t.ticketNo, t.subject, t.description, t.raisedByName, t.assignedToName, t.categoryName]}
            chipOf={(t) => t.priority}
            chipLabel="Priority"
            chips={Object.keys(listPage.chipCounts).map((p) => ({
              value: p, label: p, count: listPage.chipCounts[p] ?? 0,
            }))}
          >
            {(found) => (found.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every ticket in this view." />
            ) : (
          <div className="divide-y divide-border">
            {found.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenTicket(t)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{t.subject}</p>
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                    {t.toSupport && <Badge tone="navy" icon="help-circle">Software support</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.ticketNo}
                    {t.categoryName && ` · ${t.categoryName}`}
                    {canViewAll && ` · Raised by ${t.raisedByName}`}
                    {t.assignedToName && ` · Assigned to ${t.assignedToName}`}
                    {' · '}{new Date(t.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {raising && (
        <RaiseDialog
          categories={categories}
          busy={busy === 'raise'}
          onClose={() => setRaising(false)}
          onRaise={async ({ files, ...input }) => {
            let failed: string | null = null;
            const ok = await act('raise', async () => {
              const r = await raiseTicketAction(input);
              if (r.ticketId && r.commentId && files.length) failed = await uploadFiles('/api/helpdesk/files', r.ticketId, r.commentId, files);
              return r;
            });
            if (failed) setError(`Ticket raised, but: ${failed}`);
            if (ok) setRaising(false);
          }}
        />
      )}

      {managingCategories && (
        <CategoryDialog
          categories={categories}
          busy={busy}
          onClose={() => setManagingCategories(false)}
          onAdd={(name) => act('cat-add', () => createCategoryAction(name))}
          onRemove={(id) => act(`cat-rm-${id}`, () => removeCategoryAction(id))}
        />
      )}

      {openTicket && (
        <TicketDialog
          ticket={openTicket}
          currentUserId={currentUserId}
          canViewAll={canViewAll}
          canManage={canManage}
          onClose={() => setOpenTicket(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function RaiseDialog({
  categories, busy, onClose, onRaise,
}: {
  categories: CategoryRow[];
  busy: boolean;
  onClose: () => void;
  onRaise: (input: { categoryId: string | null; subject: string; description: string; priority: TicketPriority; toSupport: boolean; context: Record<string, string | null>; files: File[] }) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [toSupport, setToSupport] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // The page they came from, so support can open the same screen.
  const context = () => {
    let page: string | null = null;
    try { page = document.referrer ? new URL(document.referrer).pathname : null; } catch { /* no referrer */ }
    return { page, browser: navigator.userAgent, screen: `${window.innerWidth}x${window.innerHeight}` };
  };

  return (
    <Modal
      title="Raise a ticket"
      icon="alert-circle"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!subject.trim() || !description.trim()}
            onClick={() => onRaise({ categoryId: categoryId || null, subject: subject.trim(), description: description.trim(), priority, toSupport, context: context(), files })}>
            Submit ticket
          </Button>
        </div>
      }
    >
      <fieldset className="mb-3">
        <legend className="mb-1.5 text-sm font-medium">Kisko bhejna hai?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([[false, 'Apne admin ko', 'Is business ka helpdesk dekhega'], [true, 'Software support ko', 'Software banane wali team dekhegi - galti, sawaal, naya feature']] as const).map(([v, l, h]) => (
            <label key={l} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${toSupport === v ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted/40'}`}>
              <input type="radio" name="tk-to" checked={toSupport === v} onChange={() => setToSupport(v)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
              <span><span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted-foreground">{h}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.length > 0 && (
          <Field label="Category" htmlFor="tk-cat">
            <select id="tk-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Priority" htmlFor="tk-priority">
          <select id="tk-priority" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className={inputClass}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Subject" required htmlFor="tk-subject" className="sm:col-span-2">
          <input id="tk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description" required htmlFor="tk-desc" className="sm:col-span-2">
          <textarea id="tk-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
        <div className="sm:col-span-2"><FilePicker id="tk-files" files={files} onChange={setFiles} /></div>
      </div>
    </Modal>
  );
}

function CategoryDialog({
  categories, busy, onClose, onAdd, onRemove,
}: {
  categories: CategoryRow[];
  busy: string | boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');

  return (
    <Modal title="Helpdesk categories" subtitle="Shape the desk around your own departments" icon="sliders" size="sm" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="IT, HR, Facilities…" className={inputClass} />
        <Button
          variant="primary" loading={busy === 'cat-add'} disabled={!name.trim()}
          onClick={async () => { if (await onAdd(name.trim())) setName(''); }}
        >
          Add
        </Button>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet - tickets will be raised uncategorised.</p>
      ) : (
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span className="text-sm">{c.name} <span className="text-muted-foreground">({c.openTicketCount} open)</span></span>
              <Button size="sm" variant="outline" loading={busy === `cat-rm-${c.id}`} onClick={() => onRemove(c.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TicketDialog({
  ticket, currentUserId, canViewAll, canManage, onClose, onChanged,
}: {
  ticket: TicketRow;
  currentUserId: string;
  canViewAll: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<ThreadComment[] | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [toSupport, setToSupport] = useState(ticket.toSupport);
  const [assignees, setAssignees] = useState<{ id: string; fullName: string }[] | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(ticket.status);

  const isMine = ticket.raisedById === currentUserId;

  function reload() {
    fetchCommentsAction(ticket.id).then((res) => {
      if (res.error) setError(res.error);
      else setComments(res.data ?? []);
    });
  }

  useEffect(() => {
    reload();
    if (canManage) fetchAssignableUsersAction().then((res) => { if (res.data) setAssignees(res.data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  async function submitComment() {
    const text = commentBody.trim() || (files.length ? 'Screenshot' : '');
    if (!text) return;
    setBusy('comment');
    setError(null);
    const res = await addCommentAction(ticket.id, text);
    if (res.error) setError(res.error);
    else {
      const failed = res.commentId && files.length ? await uploadFiles('/api/helpdesk/files', ticket.id, res.commentId, files) : null;
      if (failed) setError(`Note posted, but: ${failed}`);
      setCommentBody(''); setFiles([]); reload(); onChanged();
    }
    setBusy(false);
  }

  async function sendToSupport() {
    setBusy('support');
    setError(null);
    const res = await sendToSupportAction(ticket.id);
    if (res.error) setError(res.error);
    else { setToSupport(true); reload(); onChanged(); }
    setBusy(false);
  }

  async function changeStatus(next: TicketStatus) {
    setBusy(`status-${next}`);
    setError(null);
    const res = await setStatusAction(ticket.id, next, null);
    if (res.error) setError(res.error);
    else { setStatus(next); reload(); onChanged(); }
    setBusy(false);
  }

  async function assign(userId: string) {
    setBusy('assign');
    setError(null);
    const res = await assignTicketAction(ticket.id, userId);
    if (res.error) setError(res.error);
    else { reload(); onChanged(); }
    setBusy(false);
  }

  const nextSteps = NEXT_STEPS.filter((s) => ALLOWED_NEXT[status].includes(s.value));

  return (
    <Modal title={ticket.subject} subtitle={ticket.ticketNo} icon="alert-circle" size="lg" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        <Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
        {ticket.categoryName && <Badge tone="neutral">{ticket.categoryName}</Badge>}
        {toSupport && <Badge tone="navy" icon="help-circle">Software support ko bheja</Badge>}
        {!toSupport && (canViewAll || isMine) && (
          <Button size="sm" variant="outline" className="ms-auto" loading={busy === 'support'} onClick={sendToSupport}>Software support ko bhejo</Button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <p className="mb-3 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">{ticket.description}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Raised by {ticket.raisedByName}</span>
        {ticket.assignedToName && <span>· Assigned to {ticket.assignedToName}</span>}
      </div>

      {(canManage || isMine) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {canManage && (
            <select
              value=""
              onChange={(e) => e.target.value && assign(e.target.value)}
              className={`${inputClass} w-auto`}
              disabled={busy === 'assign' || !assignees}
            >
              <option value="">{ticket.assignedToName ? 'Reassign to…' : 'Assign to…'}</option>
              {(assignees ?? []).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          )}
          {nextSteps.filter((s) => canManage || !s.requiresManage).map((s) => (
            <Button key={s.value} size="sm" variant="outline" loading={busy === `status-${s.value}`} onClick={() => changeStatus(s.value)}>
              {s.label}
            </Button>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
      {!comments ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mb-3 max-h-80 overflow-y-auto pe-1"><Thread comments={comments} side="business" /></div>
      )}

      {(canViewAll || isMine) && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder={toSupport ? 'Support ko jawab likhiye…' : 'Add a note…'}
              aria-label="Add a note"
              className={inputClass}
              onKeyDown={(e) => e.key === 'Enter' && submitComment()}
            />
            <Button variant="outline" loading={busy === 'comment'} disabled={!commentBody.trim() && !files.length} onClick={submitComment}>Post</Button>
          </div>
          <FilePicker id={`tk-note-files-${ticket.id}`} files={files} onChange={setFiles} />
        </div>
      )}
    </Modal>
  );
}
