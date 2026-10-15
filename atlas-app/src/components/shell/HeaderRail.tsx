'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { AnchoredPopover, type PopoverAnchor } from '@/components/ui/AnchoredPopover';
import { loadNotificationsAction } from '@/app/actions/notifications';
import { loadBellAction, markReadAction } from '@/app/actions/inbox';
import type { StoredNotification } from '@/server/notify';
import { MESSAGE_POLL_MS } from '@/lib/message-events';
import type { NotificationItem, NotificationLevel } from '@/server/notifications';

/**
 * The header's icon rail.
 *
 * It used to carry six, on the old reasoning that a rail full of controls
 * makes a product look finished. What it actually made was a row of six
 * unlabelled glyphs in the corner, four of which only opened pages the
 * sidebar already lists - a second navigation nobody asked for, in icon
 * form. Pravin, 14 Oct 2026: take them out, and put them in the menu where
 * they have names.
 *
 * Two are left, because neither is a page: Notifications, which opens its
 * own panel and must be reachable from every screen, and Fullscreen, which
 * is a window control.
 *
 * Notifications computes the same live stock and payment alerts the
 * dashboard's Insights panel shows, at request time, and lists the stored
 * ones (approvals, renewals, reminders) beside them.
 */

interface RailItem {
  key: string;
  icon: IconName;
  label: string;
  href?: string;
  /** Shown in the popover when there is no module behind the control. */
  pending?: string;
}

/**
 * SIX ICONS BECAME TWO (14 Oct 2026, Pravin).
 *
 * The rail had grown into a second navigation: SOP Guidebook, Messages,
 * Notes and Settings were all links to pages the sidebar already lists, and
 * a row of six unlabelled glyphs in the corner is a quiz, not a menu. All
 * four moved into the sidebar under Common Hub, where somebody looking for
 * them can read their names.
 *
 * What is left is the two things that are NOT pages:
 *   - Notifications, which opens its own panel and has to be reachable from
 *     every screen. Its icon was `alert-circle`, which reads as a warning;
 *     it is a bell now, like every other app.
 *   - Fullscreen, a window control with nowhere else to live - it cannot go
 *     in a menu because it is not a place.
 */
const RAIL: RailItem[] = [
  { key: 'fullscreen', icon: 'external-link', label: 'Fullscreen' },
  { key: 'bell', icon: 'bell', label: 'Notifications' },
];

const LEVEL_TONE: Record<NotificationLevel, 'danger' | 'info' | 'warning'> = {
  critical: 'danger', info: 'info', review: 'warning',
};

export function HeaderRail() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  // Stored notifications (27 Sep 2026): approvals, renewals, reminders.
  const [stored, setStored] = useState<StoredNotification[] | null>(null);
  const [unreadStored, setUnreadStored] = useState(0);
  const refreshBell = () => loadBellAction().then((r) => { setStored(r.rows); setUnreadStored(r.unread); }).catch(() => undefined);

  /*
    The header stays mounted across page changes, so counting once on mount
    left the badge frozen until a full reload. It recounts on a poll while the
    tab is visible, and when the tab comes back.

    The message count went with the mail icon (14 Oct 2026) - Messages lives
    in the sidebar now and carries its own unread count there. Only the bell
    is counted here.
  */
  useEffect(() => {
    let cancelled = false;
    const recount = () => {
      if (document.visibilityState !== 'visible') return;
      loadBellAction().then((r) => { if (!cancelled) { setStored(r.rows); setUnreadStored(r.unread); } }).catch(() => undefined);
    };
    recount();
    const timer = window.setInterval(recount, MESSAGE_POLL_MS);
    document.addEventListener('visibilitychange', recount);
    window.addEventListener('focus', recount);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recount);
      window.removeEventListener('focus', recount);
    };
  }, []);

  const close = () => { setOpenKey(null); setAnchor(null); };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const openBell = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (openKey === 'bell') { close(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenKey('bell');
    setAnchor({
      top: rect.bottom + 6, left: rect.left,
      right: Math.max(0, window.innerWidth - rect.right), width: rect.width,
    });
    if (notifications === null) {
      loadNotificationsAction().then(setNotifications).catch(() => setNotifications([]));
    }
    void refreshBell();
  };

  return (
    <div className="flex items-center gap-0.5">
      {RAIL.map((r) => {
        const cls =
          'relative grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground';
        const badgeCount = r.key === 'bell' ? unreadStored : 0;

        if (r.key === 'bell') {
          return (
            <button key={r.key} type="button" title={r.label} aria-label={r.label} onClick={openBell} className={cls}>
              <Icon name={r.icon} className="h-4 w-4" />
              {badgeCount > 0 && (
                <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-danger px-1 text-xs font-bold text-white">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        }

        if (r.href) {
          return (
            <Link key={r.key} href={r.href} title={r.label} aria-label={r.label} className={cls}>
              <Icon name={r.icon} className="h-4 w-4" />
              {badgeCount > 0 && (
                <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-danger px-1 text-xs font-bold text-white">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        }

        return (
          <button key={r.key} type="button" title={r.label} aria-label={r.label} onClick={toggleFullscreen} className={cls}>
            <Icon name={r.icon} className="h-4 w-4" />
          </button>
        );
      })}

      {openKey === 'bell' && anchor && (
        <AnchoredPopover anchor={anchor} align="end" width={340} onClose={close} className="p-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Icon name="alert-circle" className="h-4 w-4 text-muted-foreground" />
            <p className="flex-1 text-sm font-semibold">Notifications</p>
            {unreadStored > 0 && (
              <button type="button" className="text-xs font-medium text-brand hover:underline"
                onClick={() => { void markReadAction('all').then(refreshBell); }}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {stored === null ? (
              <p className="p-3 text-xs text-muted-foreground">Loading…</p>
            ) : stored.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No notifications yet.</p>
            ) : (
              stored.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? '/my/reminders'}
                  onClick={() => { if (!n.readAt) void markReadAction([n.id]).then(refreshBell); close(); }}
                  className={`block border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-muted/40 ${n.readAt ? '' : 'bg-brand/5'}`}
                >
                  <span className="flex items-start gap-1.5">
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    <span className="min-w-0 flex-1 text-sm font-medium">{n.title}</span>
                  </span>
                  {n.body && <span className="mt-0.5 block whitespace-pre-line text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </Link>
              ))
            )}
            {notifications && notifications.length > 0 && (
              <>
                <p className="border-y border-border bg-muted/40 px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Live alerts</p>
                {notifications.map((n) => (
                  <Link key={n.id} href={n.href} onClick={close} className="block border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/40">
                    <span className="flex items-center gap-1.5">
                      <Badge tone={LEVEL_TONE[n.level]}>{n.level}</Badge>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{n.title}</span>
                    </span>
                  </Link>
                ))}
              </>
            )}
          </div>
          <Link href="/my/reminders" onClick={close} className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-brand hover:bg-muted/40">
            Open My Desk
          </Link>
        </AnchoredPopover>
      )}
    </div>
  );
}
