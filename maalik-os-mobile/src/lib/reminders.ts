import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ApiError, authed } from './api';
import { send } from './outbox';
import { FullScreenAlert, type AlarmSpec } from '../../modules/full-screen-alert';

/**
 * ALARM-STYLE REMINDERS ON THE PHONE (G-40, 13 Oct 2026).
 *
 * The server keeps the reminders; this phone keeps an alarm-clock alarm for
 * each one still to ring (modules/full-screen-alert). `syncAlarms` makes the
 * phone's alarms match the server's list: on every app open, and the moment a
 * reminder is added, moved or deleted anywhere (the server sends a silent
 * 'reminder_sync' push - lib/urgent). Done / Snooze pressed on the alarm card
 * are queued by the native side and sent from here, first, so a sync never
 * brings back a reminder somebody already finished.
 */
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface ReminderRow {
  id: string; title: string; note: string | null; dueAt: string; repeat: Repeat; href: string | null;
  snoozedUntil: string | null; byOther: boolean; createdAt: string;
  /** Servers from 13 Oct 2026: when it rings next, and the key shared with the backup push. */
  ringAt?: string; alarmKey?: string;
}
export interface SetForOther { id: string; title: string; note: string | null; dueAt: string; repeat: Repeat; forName: string; snoozedUntil: string | null }
export interface Target { id: string; name: string; self: boolean }
export interface RemindersData { reminders: ReminderRow[]; forOthers: SetForOther[]; targets: Target[]; defaultTone: string; now: string }

const CACHE = 'maalik.reminders.v1';
const ACTIONS = 'maalik.reminders.actions.v1';

export const TONES: { key: string; label: string }[] = [
  { key: 'bell', label: 'Temple bell' },
  { key: 'classic', label: 'Classic alarm clock' },
  { key: 'siren', label: 'Siren' },
  { key: 'chime', label: 'Soft chime' },
  { key: 'phone', label: "The phone's own alarm sound" },
];

export const alarmsSupported = () => Platform.OS === 'android' && typeof FullScreenAlert?.sync === 'function';

export const loadCachedReminders = async (): Promise<RemindersData | null> => {
  try { const v = await AsyncStorage.getItem(CACHE); return v ? JSON.parse(v) as RemindersData : null; } catch { return null; }
};

export const fetchReminders = () => authed<RemindersData>('/api/v1/reminders');

export const addReminder = (body: { title: string; note?: string | null; dueAt: string; repeat: Repeat; forUserId?: string | null }) =>
  send<{ ok: true; id: string }>('/api/v1/reminders', body, { label: `Reminder: ${body.title}` });

export const reminderOp = (id: string, op: 'done' | 'snooze' | 'delete', minutes?: number, at?: number) =>
  authed<{ ok: true }>(`/api/v1/reminders/${id}`, {
    method: 'POST', body: JSON.stringify({ op, minutes, at: at ? new Date(at).toISOString() : undefined }),
  });

interface QueuedAction { reminderId: string; op: 'done' | 'snooze'; minutes: number; at: number }

/** Send the alarm card's Done / Snooze answers. Keeps what could not be sent. Never throws. */
export async function flushAlarmActions(): Promise<void> {
  let queue: QueuedAction[] = [];
  try { queue = JSON.parse((await AsyncStorage.getItem(ACTIONS)) ?? '[]') as QueuedAction[]; } catch { queue = []; }
  try {
    const fresh = JSON.parse(FullScreenAlert?.takeActions?.() ?? '[]') as QueuedAction[];
    queue = [...queue, ...fresh];
  } catch { /* nothing new */ }
  if (!queue.length) return;
  const left: QueuedAction[] = [];
  for (const a of queue) {
    try {
      await reminderOp(a.reminderId, a.op, a.op === 'snooze' ? a.minutes : undefined, a.at);
    } catch (e) {
      // No signal: keep it. Refused (bad snooze, gone): drop - the server knows better.
      if (e instanceof ApiError && e.status === 0) left.push(a);
    }
  }
  await AsyncStorage.setItem(ACTIONS, JSON.stringify(left)).catch(() => undefined);
}

/** Reminders as the phone's alarms need them. The person's own tone (set on the phone) wins on the native side. */
export function toAlarms(rows: ReminderRow[], defaultTone: string): AlarmSpec[] {
  return rows.map((r) => {
    const at = r.ringAt ?? r.snoozedUntil ?? r.dueAt;
    return {
      key: r.alarmKey ?? `reminder:${r.id}:${new Date(at).toISOString()}`,
      reminderId: r.id,
      atMs: Date.parse(at),
      title: r.title,
      body: r.note ?? '',
      tone: defaultTone,
      href: r.href,
      mode: 'reminder' as const,
    };
  }).filter((a) => Number.isFinite(a.atMs));
}

let syncing: Promise<RemindersData | null> | null = null;

/** Make the phone's alarms match the server. Returns the list (or the cached one offline). Never throws. */
export function syncAlarms(): Promise<RemindersData | null> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await flushAlarmActions();
      const data = await fetchReminders();
      if (!data) return null;
      await AsyncStorage.setItem(CACHE, JSON.stringify(data)).catch(() => undefined);
      if (alarmsSupported()) FullScreenAlert!.sync!(JSON.stringify(toAlarms(data.reminders, data.defaultTone)));
      return data;
    } catch {
      return loadCachedReminders();
    } finally {
      setTimeout(() => { syncing = null; }, 0);
    }
  })();
  return syncing;
}

// ------------------------------------------------------------- the person's sound

export const myTone = (): string | null => { try { return FullScreenAlert?.getTone?.() ?? null; } catch { return null; } };
export const setMyTone = (tone: string | null) => { try { FullScreenAlert?.setTone?.(tone); } catch { /* older build */ } };
export const previewTone = (tone: string) => { try { FullScreenAlert?.previewTone?.(tone); } catch { /* older build */ } };
export const stopPreview = () => { try { FullScreenAlert?.stopPreview?.(); } catch { /* older build */ } };

// ------------------------------------------------------------- phone setup checklist

export interface AlarmChecks { notifications: boolean; fullScreen: boolean; exact: boolean; battery: boolean }

export function alarmChecks(notifications: boolean): AlarmChecks {
  const call = <T>(f: (() => T) | undefined, dflt: T): T => { try { return f ? f() : dflt; } catch { return dflt; } };
  return {
    notifications,
    fullScreen: call(FullScreenAlert ? () => FullScreenAlert!.canUseFullScreen() : undefined, true),
    exact: call(FullScreenAlert?.canScheduleExact ? () => FullScreenAlert!.canScheduleExact!() : undefined, true),
    battery: call(FullScreenAlert?.ignoresBatteryOptimisation ? () => FullScreenAlert!.ignoresBatteryOptimisation!() : undefined, true),
  };
}

export const openFullScreen = () => { try { FullScreenAlert?.openFullScreenSettings(); } catch { /* none */ } };
export const openExact = () => { try { FullScreenAlert?.openExactAlarmSettings?.(); } catch { /* none */ } };
