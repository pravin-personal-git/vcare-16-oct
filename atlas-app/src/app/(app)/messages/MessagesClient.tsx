'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { initials } from '@/lib/revenue';
import { loadConversationsAction, loadThreadAction, sendMessageAction, type ActionState } from './actions';
import { MESSAGES_CHANGED, MESSAGE_POLL_MS } from '@/lib/message-events';
import type { ConversationRow, MessageRow } from '@/server/messages';

/**
 * Header rail Messages, as a real internal inbox - direct messages between
 * people in the same organisation. No threading, no attachments, no group
 * chat: one conversation per pair of people, same shape as the reference
 * app's message centre needs to cover the common case, not every case.
 */

type Conversation = Omit<ConversationRow, 'lastAt'> & { lastAt: string };

function fmt(d: string | Date) {
  return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function MessagesClient({
  conversations, orgUsers,
}: {
  conversations: Conversation[];
  orgUsers: { id: string; fullName: string }[];
}) {
  const [list, setList] = useState(conversations);
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return conversations[0]?.otherUserId ?? null;
    const fromUrl = new URLSearchParams(window.location.search).get('with');
    return fromUrl ?? conversations[0]?.otherUserId ?? null;
  });
  const [thread, setThread] = useState<MessageRow[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refreshThread = (otherUserId: string, quiet = false) => {
    if (!quiet) setLoadingThread(true);
    startTransition(async () => {
      const rows = await loadThreadAction(otherUserId);
      setThread(rows);
      setLoadingThread(false);
      setList((prev) => prev.map((c) => (c.otherUserId === otherUserId ? { ...c, unreadCount: 0 } : c)));
      // Opening a thread marks it read - tell the header badge now.
      window.dispatchEvent(new Event(MESSAGES_CHANGED));
    });
  };

  // New messages arrive without a reload: while the tab is visible, the
  // conversation list and the open thread are re-read on the same poll the
  // header badge uses.
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void loadConversationsAction().then((rows) => {
        const open = activeRef.current;
        setList((prev) => {
          const fresh = rows.map((r) => ({ ...r, lastAt: new Date(r.lastAt).toISOString() }));
          // Keep a just-started conversation that has no messages yet.
          const extra = prev.filter((p) => !fresh.some((f) => f.otherUserId === p.otherUserId));
          return [...extra, ...fresh];
        });
        if (open && rows.some((r) => r.otherUserId === open && r.unreadCount > 0)) refreshThread(open, true);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(tick, MESSAGE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) refreshThread(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openConversation = (otherUserId: string) => {
    setActiveId(otherUserId);
    setShowNew(false);
    refreshThread(otherUserId);
  };

  const startNew = (userId: string) => {
    setShowNew(false);
    if (!list.some((c) => c.otherUserId === userId)) {
      const person = orgUsers.find((u) => u.id === userId);
      if (person) {
        setList((prev) => [{ otherUserId: userId, otherUserName: person.fullName, lastBody: '', lastAt: new Date().toISOString(), unreadCount: 0 }, ...prev]);
      }
    }
    openConversation(userId);
  };

  const send = () => {
    if (!activeId || !draft.trim()) return;
    setError(null);
    const body = draft;
    setDraft('');
    startTransition(async () => {
      const res: ActionState = await sendMessageAction(activeId, body);
      if (res.error) { setError(res.error); setDraft(body); return; }
      refreshThread(activeId);
    });
  };

  const active = list.find((c) => c.otherUserId === activeId) ?? null;
  const alreadyMessaged = new Set(list.map((c) => c.otherUserId));

  return (
    <div>
      <PageHeader badge="MSG" title="Messages" subtitle="Direct messages with people in your organisation" />

      <div className="grid gap-4 overflow-hidden rounded-lg border border-border bg-card md:grid-cols-[280px_1fr]" style={{ height: '70vh' }}>
        <div className="flex flex-col border-e border-border">
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-medium text-brand hover:bg-muted/40"
          >
            <Icon name="user-plus" className="h-4 w-4" />
            New message
          </button>
          {showNew && (
            <div className="max-h-48 overflow-y-auto border-b border-border">
              {orgUsers.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">Nobody else is in your organisation yet.</p>
              )}
              {orgUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => startNew(u.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted/40"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
                    {initials(u.fullName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{u.fullName}</span>
                  {alreadyMessaged.has(u.id) && <span className="text-xs text-muted-foreground">Sent</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {list.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">No conversations yet. Start one above.</p>
            )}
            {list.map((c) => (
              <button
                key={c.otherUserId}
                type="button"
                onClick={() => openConversation(c.otherUserId)}
                className={`flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-start transition hover:bg-muted/30 ${
                  c.otherUserId === activeId ? 'bg-brand/5' : ''
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
                  {initials(c.otherUserName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.otherUserName}</span>
                    {c.unreadCount > 0 && (
                      <span className="grid h-4 min-w-[1rem] shrink-0 place-items-center rounded-full bg-danger px-1 text-xs font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{c.lastBody || 'No messages yet'}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          {!active ? (
            <EmptyState icon="mail" title="No conversation selected" hint="Pick someone on the left, or start a new message." />
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-navy-fg">
                  {initials(active.otherUserName)}
                </span>
                <p className="text-sm font-semibold">{active.otherUserName}</p>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {loadingThread ? (
                  <p className="text-center text-xs text-muted-foreground">Loading…</p>
                ) : thread.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground">No messages yet. Say hello.</p>
                ) : (
                  thread.map((m) => (
                    <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        m.fromMe ? 'bg-brand text-brand-fg' : 'bg-muted'
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`mt-1 text-xs ${m.fromMe ? 'text-brand-fg/70' : 'text-muted-foreground'}`}>
                          {fmt(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {error && <p className="border-t border-danger/30 bg-danger/5 px-4 py-2 text-xs text-on-tint-danger">{error}</p>}
              <div className="flex items-end gap-2 border-t border-border p-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Type a message…"
                  rows={1}
                  className="field-input flex-1 resize-none"
                />
                <button
                  type="button"
                  disabled={pending || !draft.trim()}
                  onClick={send}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-fg transition hover:opacity-90 disabled:opacity-50"
                  aria-label="Send"
                >
                  <Icon name="send" className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
