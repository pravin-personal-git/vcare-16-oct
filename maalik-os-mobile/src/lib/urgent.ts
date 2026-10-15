import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { FullScreenAlert } from '../../modules/full-screen-alert';
import { syncAlarms } from './reminders';

/**
 * Call-style Urgent alerts (6 Oct 2026). For a phone on 1.0.14+, the server
 * sends an Urgent push (approval waiting, escalation) as data only - no title
 * or body - so Android hands it to this task even when the app is closed, and
 * the task rings the phone and opens the full-screen card (native module
 * modules/full-screen-alert). Older phones keep getting the normal banner.
 *
 * If the native module is missing for any reason the same push still arrives
 * as an ordinary loud notification, so an Urgent alert is never silently lost.
 */
export const URGENT_TASK = 'maalik-os.urgent-push';

interface UrgentData {
  title: string; body: string; href: string | null; id: string;
  /** A personal reminder's backup push (servers from 13 Oct 2026): ring it as an alarm, once per moment. */
  alarm?: { reminderId: string; key: string; tone: string | null };
}

const parse = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch { return null; } }
  return null;
};

/** Expo's payload differs by path (task, foreground, FCM JSON in `body`/`dataString`); find ours in any of them. */
export function urgentFrom(payload: unknown): UrgentData | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length) {
    const o = parse(queue.shift());
    if (!o || seen.has(o)) continue;
    seen.add(o);
    if (o.fullScreen === true || o.fullScreen === 'true') {
      const title = typeof o.title === 'string' && o.title ? o.title : 'Urgent';
      const body = typeof o.body === 'string' ? o.body : (typeof o.message === 'string' ? o.message : '');
      const href = typeof o.href === 'string' && o.href.startsWith('/') && !o.href.startsWith('//') ? o.href : null;
      const id = typeof o.notificationId === 'string' ? o.notificationId : `${title}|${Date.now()}`;
      const alarm = (o.alarm === true || o.alarm === 'true') && typeof o.reminderId === 'string'
        ? { reminderId: o.reminderId, key: typeof o.alarmKey === 'string' ? o.alarmKey : `reminder:${o.reminderId}:${id}`, tone: typeof o.tone === 'string' ? o.tone : null }
        : undefined;
      return { title, body, href, id, alarm };
    }
    for (const k of ['data', 'dataString', 'body', 'notification', 'request', 'content']) if (k in o) queue.push(o[k]);
  }
  return null;
}

/** A silent "your reminders changed" push (G-40): the app re-reads them and resets its alarms. */
export function isReminderSync(payload: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length) {
    const o = parse(queue.shift());
    if (!o || seen.has(o)) continue;
    seen.add(o);
    if (o.kind === 'reminder_sync') return true;
    for (const k of ['data', 'dataString', 'body', 'notification', 'request', 'content']) if (k in o) queue.push(o[k]);
  }
  return false;
}

async function ring(u: UrgentData) {
  // A reminder rings as an alarm (1.0.19+), and only if the phone's own alarm has not already rung for this moment.
  if (u.alarm && FullScreenAlert?.ring) {
    FullScreenAlert.ring(JSON.stringify({
      key: u.alarm.key, reminderId: u.alarm.reminderId, atMs: Date.now(), title: u.title, body: u.body,
      tone: u.alarm.tone, href: u.href, mode: 'reminder',
    }));
    return;
  }
  if (FullScreenAlert) { FullScreenAlert.show(u.id, u.title, u.body, u.href); return; }
  // No native module: a loud ordinary notification instead.
  await Notifications.scheduleNotificationAsync({
    content: { title: u.title, body: u.body, data: { href: u.href ?? '/my/reminders' }, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: 'urgent' } : null,
  }).catch(() => undefined);
}

// Module scope, as the task manager requires: Android may start the app in
// the background just to run this.
if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(URGENT_TASK, async ({ data }) => {
    if (data && !('actionIdentifier' in data)) {
      if (isReminderSync(data)) { await syncAlarms(); return; }
      const u = urgentFrom(data);
      if (u) await ring(u);
    }
  });
  Notifications.registerTaskAsync(URGENT_TASK).catch(() => undefined);

  // With the app open the same push may come through the listener instead.
  Notifications.addNotificationReceivedListener((n) => {
    if (isReminderSync(n.request.content.data) || isReminderSync(n.request.trigger)) { void syncAlarms(); return; }
    const u = urgentFrom(n.request.content.data) ?? urgentFrom(n.request.trigger);
    if (u) void ring(u);
  });
}

/** Does this build ring full-screen? Sent with the push token so the server knows what to send. */
export const canRingFullScreen = () => Platform.OS === 'android' && !!FullScreenAlert;

/** Android 14+: has the person allowed full-screen alerts for Vcare? */
export const fullScreenAllowed = () => {
  try { return FullScreenAlert ? FullScreenAlert.canUseFullScreen() : true; } catch { return true; }
};

export const openFullScreenSettings = () => { try { FullScreenAlert?.openFullScreenSettings(); } catch { /* no settings screen */ } };

/** Where the last full-screen alert's Open button wanted to go, read once. */
export const takeAlertHref = (): string | null => {
  try { return FullScreenAlert?.takeOpenedHref() ?? null; } catch { return null; }
};
