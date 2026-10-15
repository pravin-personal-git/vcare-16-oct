'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { NOTICE_CATEGORIES } from '@/lib/notices';
import { saveNotice, removeNotice } from './actions';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import { useListParams } from '@/components/ui/useListParams';
import { istDate, istDayEnd } from '@/lib/date-ranges';

interface NoticeRow {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: string | null;
  isExpired: boolean;
  createdByName: string | null;
  createdAt: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function NoticesClient({
  notices, canEdit, isSingleStore, listPage, show,
}: { notices: NoticeRow[]; canEdit: boolean; isSingleStore: boolean; listPage: CardListPage; show: 'active' | 'expired' | 'all' }) {
  const router = useRouter();
  // Active / Expired / All lives in the address and runs on the server (F1b server paging).
  const list = useListParams();
  const filter = show;
  const setFilter = (f: 'active' | 'expired' | 'all') => list.set({ show: f === 'active' ? null : f });
  const [editing, setEditing] = useState<NoticeRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NoticeRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function act(fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  return (
    <div>
      <PageHeader
        badge="NA"
        title="Notices &amp; Announcements"
        subtitle="Shown on the dashboard, newest and pinned first"
        actions={canEdit && isSingleStore ? (
          <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>
            Post Notice
          </Button>
        ) : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to post a notice.</p>
        </Card>
      )}

      <div className="mb-3 flex gap-1.5">
        {(['active', 'expired', 'all'] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'primary' : 'outline'} onClick={() => setFilter(f)}>
            {f === 'active' ? 'Active' : f === 'expired' ? 'Expired' : 'All'}
          </Button>
        ))}
      </div>

      <SectionCard title={`${listPage.server.total} notice${listPage.server.total === 1 ? '' : 's'}`} icon="info" bodyClassName="p-0">
        {listPage.server.total === 0 ? (
          <EmptyState icon="info" title="Nothing here" hint="Nothing has been posted in this view yet." />
        ) : (
          /* F1b / D17. The Active/Expired/All switch above decides which
             notices are in play; this finds the one somebody half-remembers,
             by its title, its words or its category. */
          <ListFilter
            server={listPage.server}
            exportScreen="notices"
            rows={notices}
            // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
            dates={[{ key: 'posted', label: 'Posted on', of: (r) => r.createdAt }, { key: 'expires', label: 'Expires on', of: (r) => r.expiresAt, future: true }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
            noun="notices"
            placeholder="Title, words in the notice, category…"
            searchOn={(n) => [n.title, n.body, n.category, n.createdByName]}
            chipOf={(n) => n.category}
            chipLabel="Category"
            chips={Object.keys(listPage.chipCounts).sort().map((c) => ({
              value: c, label: c, count: listPage.chipCounts[c] ?? 0,
            }))}
          >
            {(found) => (found.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every notice in this view." />
            ) : (
          <div className="divide-y divide-border">
            {found.map((n) => (
              <div key={n.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.pinned && <Icon name="alert-circle" className="h-3.5 w-3.5 text-accent" />}
                      <p className="text-sm font-semibold">{n.title}</p>
                      {n.isExpired && <Badge tone="neutral">Expired</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-foreground/90">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.category} · {fmt(n.createdAt)}{n.createdByName && ` · ${n.createdByName}`}
                      {n.expiresAt && ` · Expires ${fmt(n.expiresAt)}`}
                    </p>
                  </div>
                  {canEdit && isSingleStore && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(n)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleting(n)}>Delete</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {editing && (
        <NoticeForm
          notice={editing === 'new' ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act(() => saveNotice(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete notice?"
          message={`"${deleting.title}" will be removed for everyone.`}
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const ok = await act(() => removeNotice(deleting.id));
            if (ok) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function NoticeForm({
  notice, busy, onClose, onSave,
}: {
  notice: NoticeRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { title: string; body: string; category: string; pinned: boolean; expiresAt: Date | null }) => void;
}) {
  const [title, setTitle] = useState(notice?.title ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [category, setCategory] = useState(notice?.category ?? NOTICE_CATEGORIES[0]);
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState(notice?.expiresAt ? istDate(new Date(notice.expiresAt)) : '');

  return (
    <Modal
      title={notice ? 'Edit notice' : 'Post notice'}
      icon="info"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim() || !body.trim()}
            onClick={() => onSave({
              title: title.trim(),
              body: body.trim(),
              category,
              pinned,
              // The end of that INDIA day, whatever zone the browser is in (9 Oct 2026).
              expiresAt: expiresAt ? istDayEnd(expiresAt) : null,
            })}
          >
            {notice ? 'Save' : 'Post'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Title" required htmlFor="no-title">
          <input id="no-title" value={title} onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Notice" required htmlFor="no-body">
          <textarea id="no-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="no-category">
            <select id="no-category" value={category} onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand">
              {NOTICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Expires" hint="Leave blank for a standing notice" htmlFor="no-expires">
            <input id="no-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand" />
          </Field>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span className="text-sm">Pin to the top</span>
        </label>
      </div>
    </Modal>
  );
}
