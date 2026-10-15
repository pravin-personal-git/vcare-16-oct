import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { isAlarmTone, type AlarmTone } from '@/lib/alarm-tones';

/**
 * Stored notifications - the bell, My Reminders & Requests, push and email
 * (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §2).
 *
 * `notify()` is the one door. It writes one row per person, never twice for
 * the same (person, dedupeKey), then hands each new row to the channels the
 * business and the person allow. Channels that are not set up yet (no
 * RESEND_API_KEY, no push token) are skipped quietly - the bell always works.
 */
export type NotificationKind = 'approval_waiting' | 'approval_decided' | 'escalation' | 'renewal' | 'reminder' | 'system' | 'job' | 'shop_request';

export const KIND_LABEL: Record<NotificationKind, string> = {
  approval_waiting: 'Approvals waiting on me',
  approval_decided: 'Decisions on my requests',
  escalation: 'Escalations',
  renewal: 'Renewals & due dates',
  reminder: 'Personal reminders',
  system: 'System',
  job: 'Field jobs',
  shop_request: 'Online shop requests',
};

export interface NotifyInput {
  storeId: string;
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Same key for the same person = sent once. */
  dedupeKey: string;
}

// ------------------------------------------------------------------ settings

/**
 * How a phone notification arrives (5 Oct 2026, Pravin: the owner chooses, per
 * activity, what kind of notification it is):
 *   quiet  - in the list and the tray, no sound;
 *   normal - banner and sound;
 *   urgent - the loudest the phone allows: on the lock screen, through Do Not
 *            Disturb where permitted, long vibration (Vcare "urgent" channel).
 */
export type PushStyle = 'quiet' | 'normal' | 'urgent';

export interface ChannelSettings {
  /** kind -> channels on for it. The bell is always on and not listed. */
  channels: Partial<Record<NotificationKind, { push: boolean; email: boolean; style?: PushStyle }>>;
}
export interface BusinessNotificationSettings extends ChannelSettings {
  /**
   * URGENT ALERTS ON A PHONE NOBODY IS SIGNED INTO (F-05, 10 Oct 2026).
   *
   * On, which is what every business had before this switch existed, because
   * the point of an Urgent alert is to reach a person and somebody who left
   * the app is still the person you need. What reaches them carries NO
   * business detail - see `sendPush` - so the choice here is only between
   * "ring the phone with nothing on it" and "wait until they sign in".
   *
   * A business that hands phones around, or has people leaving, may prefer
   * off. Nobody should have to understand push notifications to decide it,
   * which is why the screen asks it in those words.
   */
  alertsWhenSignedOut: boolean;
  renewalOffsets: number[];
  whatsappTemplate: string | null;
  dailySummary: boolean;
  /**
   * The alarm sound a reminder rings with on Vcare, until the person picks
   * their own on the phone (decision 13, 13 Oct 2026). One of ALARM_TONES.
   */
  alarmTone: AlarmTone;
  /** Last time the reminder generator ran for this branch (throttle). */
  lastRunAt?: string | null;
}

const DEFAULT_CHANNELS: ChannelSettings['channels'] = {
  approval_waiting: { push: true, email: true, style: 'urgent' },
  approval_decided: { push: true, email: false },
  escalation: { push: true, email: true, style: 'urgent' },
  renewal: { push: true, email: true },
  // Rings like an alarm clock (G-40, decision 1): full screen on a locked phone.
  reminder: { push: true, email: false, style: 'urgent' },
  system: { push: true, email: true },
  // Field jobs (workflow slice 7): the phone is where technicians are.
  job: { push: true, email: false },
  // A customer asked from the online shop (13 Oct 2026) - somebody must ring them.
  shop_request: { push: true, email: false },
};

/**
 * A business that saved its channels before a kind had a default style keeps
 * that default - e.g. reminders saved as {push, email} on 5 Oct still ring
 * like an alarm (G-40). A style somebody actually chose is never touched.
 */
function withDefaultStyles(ch: ChannelSettings['channels']): ChannelSettings['channels'] {
  const out = { ...ch };
  for (const [k, def] of Object.entries(DEFAULT_CHANNELS) as [NotificationKind, { push: boolean; email: boolean; style?: PushStyle }][]) {
    const cur = out[k];
    if (cur && !cur.style && def.style) out[k] = { ...cur, style: def.style };
  }
  return out;
}

export async function businessSettings(storeId: string): Promise<BusinessNotificationSettings> {
  const row = await db.notificationSetting.findFirst({ where: { storeId, userId: null }, select: { settings: true } });
  const s = (row?.settings ?? {}) as Partial<BusinessNotificationSettings>;
  return {
    channels: withDefaultStyles({ ...DEFAULT_CHANNELS, ...(s.channels ?? {}) }),
    alertsWhenSignedOut: s.alertsWhenSignedOut !== false,
    renewalOffsets: Array.isArray(s.renewalOffsets) && s.renewalOffsets.length ? s.renewalOffsets : [15, 7, 0],
    whatsappTemplate: typeof s.whatsappTemplate === 'string' && s.whatsappTemplate.trim() ? s.whatsappTemplate : null,
    dailySummary: s.dailySummary !== false,
    alarmTone: isAlarmTone(s.alarmTone) ? s.alarmTone : 'bell',
    lastRunAt: s.lastRunAt ?? null,
  };
}

export async function saveBusinessSettings(storeId: string, patch: Partial<BusinessNotificationSettings>) {
  const current = await businessSettings(storeId);
  const settings = { ...current, ...patch } as object;
  const existing = await db.notificationSetting.findFirst({ where: { storeId, userId: null }, select: { id: true } });
  if (existing) await db.notificationSetting.update({ where: { id: existing.id }, data: { settings } });
  else await db.notificationSetting.create({ data: { storeId, userId: null, settings } });
}

async function personalChannels(storeId: string, userId: string): Promise<ChannelSettings['channels']> {
  const row = await db.notificationSetting.findUnique({ where: { storeId_userId: { storeId, userId } }, select: { settings: true } });
  return ((row?.settings ?? {}) as Partial<ChannelSettings>).channels ?? {};
}

export async function saveMyChannels(storeId: string, userId: string, channels: ChannelSettings['channels']) {
  await db.notificationSetting.upsert({
    where: { storeId_userId: { storeId, userId } },
    create: { storeId, userId, settings: { channels } },
    update: { settings: { channels } },
  });
}

export async function myChannelSettings(storeId: string, userId: string) {
  const [biz, mine] = await Promise.all([businessSettings(storeId), personalChannels(storeId, userId)]);
  return { business: biz.channels, mine };
}

// ------------------------------------------------------------------ the door

export async function notify(input: NotifyInput): Promise<number> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return 0;
  const existing = await db.notification.findMany({
    where: { userId: { in: userIds }, dedupeKey: input.dedupeKey },
    select: { userId: true },
  });
  const have = new Set(existing.map((e) => e.userId));
  const fresh = userIds.filter((u) => !have.has(u));
  if (!fresh.length) return 0;

  const created = [];
  for (const userId of fresh) {
    try {
      created.push(await db.notification.create({
        data: {
          storeId: input.storeId, userId, kind: input.kind, title: input.title.slice(0, 200),
          body: input.body?.slice(0, 1000) ?? null, href: input.href ?? null,
          entityType: input.entityType ?? null, entityId: input.entityId ?? null, dedupeKey: input.dedupeKey,
        },
      }));
    } catch {
      // Unique (userId, dedupeKey): a parallel run got there first. Fine.
    }
  }
  if (created.length) await deliver(input.storeId, created).catch((e) => console.error('[notify] delivery failed', e));
  return created.length;
}

// ------------------------------------------------------------------ channels

type Row = {
  id: string; userId: string; kind: string; title: string; body: string | null; href: string | null;
  entityId?: string | null; dedupeKey?: string | null;
};

async function deliver(storeId: string, rows: Row[]) {
  const biz = await businessSettings(storeId);
  for (const n of rows) {
    const kind = n.kind as NotificationKind;
    const mine = await personalChannels(storeId, n.userId);
    const want = { ...(biz.channels[kind] ?? { push: false, email: false }), ...(mine[kind] ?? {}) };
    // The style is the business's choice per activity; a person can still turn push off.
    if (want.push) {
      await sendPush(n, biz.channels[kind]?.style ?? 'normal', biz.alertsWhenSignedOut, biz.alarmTone).catch(() => undefined);
    }
    if (want.email) await sendEmail(n).catch(() => undefined);
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';

async function record(notificationId: string, channel: string, status: 'sent' | 'skipped' | 'failed', error?: string) {
  await db.notificationDelivery.create({ data: { notificationId, channel, status, error: error?.slice(0, 500) ?? null } }).catch(() => undefined);
}

/**
 * WHAT A PHONE NOBODY IS SIGNED INTO IS TOLD (F-05, 10 Oct 2026).
 *
 * Nothing. It is told that something is waiting, and that is all.
 *
 * This was the last thing open on F-05, and it was open because it is a
 * security question rather than a build one. Signing out of Vcare leaves
 * the push token exactly where it was - Expo neither knows nor cares whether
 * an app has a session - so Urgent alerts kept arriving on phones nobody was
 * signed into, with the title and the body intact. On a lock screen that
 * reads "Approval waiting - invoice INV-BR001-2026-0042, Rs 4,38,000, Sharma
 * Traders", to whoever is holding the phone: the technician who resigned last
 * week, the family member who borrowed it, the person who found it.
 *
 * Deleting the token instead was the other option, and it is worse. The whole
 * point of an Urgent alert is that somebody is reached; a manager who closed
 * the app on Friday and is needed on Saturday should ring, not be silently
 * skipped. So the knock gets through and the contents do not.
 *
 * A business can switch even the knock off - `alertsWhenSignedOut`, in
 * Settings then Approval Rules and Notifications - and then a signed-out
 * phone is skipped and the bell on the website still has everything.
 */
const SIGNED_OUT_TITLE = 'Vcare';
const SIGNED_OUT_BODY = 'Something urgent needs you. Open Vcare and sign in.';

/** Vcare push through Expo's service. No registered phone = skipped. */
async function sendPush(n: Row, style: PushStyle = 'normal', alertsWhenSignedOut = true, tone: AlarmTone = 'bell') {
  const all = await db.pushToken.findMany({
    where: { userId: n.userId },
    select: { token: true, fullScreen: true, signedOut: true },
  });
  if (!all.length) return record(n.id, 'push', 'skipped', 'no phone registered');

  // A signed-out phone is dropped entirely when the business said so, and
  // otherwise kept - but it never learns what the notification said.
  const tokens = alertsWhenSignedOut ? all : all.filter((t) => !t.signedOut);
  if (!tokens.length) {
    return record(n.id, 'push', 'skipped', 'signed out, and this business does not alert signed-out phones');
  }

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokens.map((t) => {
      // Nothing about the business leaves for a phone with no session: not the
      // title, not the body, and not `href`, which names a document.
      const title = t.signedOut ? SIGNED_OUT_TITLE : n.title;
      const body = t.signedOut ? SIGNED_OUT_BODY : n.body ?? '';
      const data = t.signedOut
        ? { href: '/my/reminders', notificationId: n.id, style, signedOut: true }
        : { href: n.href ?? '/my/reminders', notificationId: n.id, style };

      /**
       * A personal reminder carries what the phone's own alarm needs (1.0.19+):
       * which reminder and which moment (`alarmKey`, the same as the dedupe
       * key), so a phone whose alarm already rang ignores this backup, and the
       * business's tone. Older phones ignore the extra keys and ring the call
       * card as before. Never for a signed-out phone - it learns nothing.
       */
      const alarm = n.kind === 'reminder' && !t.signedOut && n.entityId
        ? { alarm: true, reminderId: n.entityId, alarmKey: n.dedupeKey ?? null, tone }
        : {};
      return style === 'urgent' && t.fullScreen
        // Call-style (Vcare 1.0.14+): data only, so the phone's own task
        // rings and opens the full-screen card even with the app closed.
        ? { to: t.token, priority: 'high', data: { ...data, ...alarm, fullScreen: true, title, body } }
        : {
          to: t.token, title, body: body || undefined,
          // Android channel the phone created for each style (Vcare
          // 1.0.13+); older apps fall back to their default channel.
          channelId: style === 'urgent' ? 'urgent' : style === 'quiet' ? 'quiet' : 'default',
          priority: style === 'quiet' ? 'normal' : 'high',
          ...(style === 'quiet' ? {} : { sound: 'default' }),
          data,
        };
    })),
  }).catch((e: Error) => ({ ok: false, statusText: e.message }) as Response);
  return record(n.id, 'push', res.ok ? 'sent' : 'failed', res.ok ? undefined : res.statusText);
}

/**
 * A silent message to a person's phones - nothing is shown; the app reads
 * `kind` and acts (e.g. 'reminder_sync': re-read reminders and reset the
 * alarms, G-40). Signed-out phones are skipped: there is nothing of theirs
 * to sync. No row in the bell - this is plumbing, not a notification.
 */
export async function pushData(userId: string, data: Record<string, string | number | boolean>) {
  const tokens = await db.pushToken.findMany({ where: { userId, signedOut: false }, select: { token: true } });
  if (!tokens.length) return false;
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokens.map((t) => ({ to: t.token, priority: 'high', data, _contentAvailable: true }))),
  }).catch(() => null);
  return !!res?.ok;
}

/** Email through Resend - off until RESEND_API_KEY is set in Vercel. */
async function sendEmail(n: Row) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return record(n.id, 'email', 'skipped', 'email not set up');
  const user = await db.user.findUnique({ where: { id: n.userId }, select: { email: true, fullName: true } });
  if (!user?.email) return record(n.id, 'email', 'skipped', 'no email address');
  const link = `${APP_URL}${n.href ?? '/my/reminders'}`;
  const html = `<p>Hello ${escapeHtml(user.fullName)},</p><p><strong>${escapeHtml(n.title)}</strong></p>`
    + (n.body ? `<p>${escapeHtml(n.body).replace(/\n/g, '<br>')}</p>` : '')
    + `<p><a href="${link}">Open in Atlas</a></p><p style="color:#888;font-size:12px">Change what you get emailed in Atlas › My Reminders & Requests › Settings.</p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Atlas <notify@nairsolutions.org>', to: [user.email], subject: n.title, html }),
  }).catch((e: Error) => ({ ok: false, statusText: e.message }) as Response);
  return record(n.id, 'email', res.ok ? 'sent' : 'failed', res.ok ? undefined : res.statusText);
}

/**
 * A message to a CUSTOMER (not a staff user).
 *
 * WORKSTREAM D, 1 Oct 2026: this now goes through `server/messaging`, which
 * asks the BRANCH which provider it uses - WhatsApp first where it is set up,
 * then email - instead of one deployment-wide Resend key shared by every
 * tenant. The provider is chosen by the client on Settings > Email & WhatsApp.
 *
 * `storeId` is optional only so the two existing callers could be moved one at
 * a time rather than in the same change as the layer itself. Without it the
 * old environment-variable path still runs, which is the behaviour this
 * product had yesterday - no caller gets worse.
 *
 * Returns the channel used, or null.
 */
export async function sendCustomerMessage(to: { email: string | null; name: string; phone?: string | null }, subject: string, text: string, link?: string, storeId?: string): Promise<'email' | 'whatsapp' | null> {
  if (storeId) {
    const { sendToCustomer } = await import('./messaging');
    const sent = await sendToCustomer(storeId, { name: to.name, email: to.email, phone: to.phone ?? null }, { subject, text, link })
      .catch(() => null);
    if (sent?.result.ok && sent.channel) return sent.channel;
    // Configured but failed, or not configured at all: fall through to the
    // old path rather than dropping the message. A customer waiting for an
    // OTP must not be the one who discovers a settings page is wrong.
  }

  const key = process.env.RESEND_API_KEY;
  if (!key || !to.email) return null;
  const html = `<p>Hello ${escapeHtml(to.name || 'there')},</p><p>${escapeHtml(text)}</p>`
    + (link ? `<p><a href="${link}">Open</a></p>` : '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Atlas <notify@nairsolutions.org>', to: [to.email], subject, html }),
  }).catch(() => null);
  return res?.ok ? 'email' : null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ------------------------------------------------------------------ reading

export interface StoredNotification {
  id: string; kind: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string;
}

/**
 * `range` (My Desk, 9 Oct 2026): the newest `take` WITHIN a date window, so
 * "Last month" shows last month's notifications rather than whichever of the
 * newest hundred happened to fall in it. `unread` stays the overall count.
 */
export async function myNotifications(
  scope: StoreScope, userId: string, take = 20, range?: { gte?: Date; lt?: Date },
) {
  const where = { ...scopeWhere(scope), userId };
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { ...where, ...(range ? { createdAt: range } : {}) }, orderBy: { createdAt: 'desc' }, take, select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true } }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return {
    unread,
    rows: rows.map((r): StoredNotification => ({ ...r, readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })),
  };
}

export async function markRead(userId: string, ids: string[] | 'all') {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

/** Active people holding any of these permissions in a branch (the shop request alerts, 13 Oct 2026). */
export async function usersWithAnyPermission(storeId: string, keys: string[]): Promise<string[]> {
  const rows = await db.userStoreRole.findMany({
    where: { storeId, user: { isActive: true }, role: { permissions: { some: { permission: { key: { in: keys } } } } } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/** Owner / admins of a branch - whoever holds settings.edit there. */
export async function ownersOf(storeId: string): Promise<string[]> {
  const rows = await db.userStoreRole.findMany({
    where: { storeId, user: { isActive: true }, role: { permissions: { some: { permission: { key: 'settings.edit' } } } } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

export async function registerPushToken(userId: string, token: string, deviceName: string | null, fullScreen = false) {
  if (!/^ExponentPushToken\[[\w-]+\]$/.test(token)) return;
  await db.pushToken.upsert({
    where: { token },
    // Signing in is what clears `signedOut`. The app calls this on every
    // open, so a phone that comes back starts receiving the real contents
    // again without anybody having to do anything.
    create: { userId, token, deviceName, fullScreen, signedOut: false },
    update: { userId, deviceName, fullScreen, signedOut: false, lastSeenAt: new Date() },
  });
}

/**
 * The phone signed out (F-05, 10 Oct 2026).
 *
 * Marked, not deleted, so Urgent alerts still ring - with nothing in them.
 * See `sendPush` for what that phone is allowed to be told. Silent about an
 * unknown token on purpose: this is called from a sign-out, which is not a
 * place to tell a caller what exists.
 */
export async function markPushTokenSignedOut(token: string) {
  if (!/^ExponentPushToken\[[\w-]+\]$/.test(token)) return;
  await db.pushToken.updateMany({ where: { token }, data: { signedOut: true } });
}
