import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { authed } from './api';
import { loadSession } from './session';
import { canRingFullScreen } from './urgent';
import { rememberPushToken } from './push-token';

/**
 * Phone notifications for approvals, renewals and reminders (27 Sep 2026,
 * NOTIFICATIONS-APPROVALS-SPEC.md §2). The website sends them through Expo's
 * push service to the token registered here.
 *
 * Android needs the app's Firebase setup (google-services.json) for push to
 * be delivered; until that is in the build, getting a token fails and this
 * quietly does nothing - the bell on the website still has everything.
 */

// Shown even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true,
  }),
});

/** Where a tapped notification wants to go on the website (read once by the owner view). */
let pendingPath: string | null = null;
export function takePendingPath(): string | null {
  const p = pendingPath;
  pendingPath = null;
  return p;
}

/**
 * A tapped job notification, for the field app: the job id, read once. The
 * employee home opens it - after the opening animation on a cold start, at
 * once when the app was already running (live test 28 Sep 2026: a tap only
 * opened the home screen).
 */
let homeReady = false;
export function markHomeReady() { homeReady = true; }
export const isHomeReady = () => homeReady;
export function takePendingJob(): string | null {
  const m = pendingPath ? /^\/services\/complaints\/([\w-]+)$/.exec(pendingPath) : null;
  if (!m) return null;
  pendingPath = null;
  return m[1];
}

export function rememberTap(data: unknown) {
  const href = (data as { href?: unknown } | null)?.href;
  if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) pendingPath = href;
}

/** Ask once, then register this phone for the signed-in business user. Never throws. */
export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;
    const s = await loadSession();
    if (!s || s.kind !== 'user') return;
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Vcare',
      importance: Notifications.AndroidImportance.HIGH,
    });
    // 5 Oct 2026: the owner picks, per activity, how loud the phone is
    // (Settings > Approval Rules & Notifications). The server names one of
    // these channels on each push.
    await Notifications.setNotificationChannelAsync('urgent', {
      name: 'Urgent - approvals and escalations',
      description: 'Rings like an alarm and shows on the lock screen.',
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      vibrationPattern: [0, 600, 300, 600, 300, 900],
      enableVibrate: true,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('quiet', {
      name: 'Quiet',
      description: 'Arrives without sound.',
      importance: Notifications.AndroidImportance.LOW,
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    // Kept for the sign-out call, which tells the server this phone is empty
    // so Urgent alerts arrive with no business detail in them (F-05).
    await rememberPushToken(token);
    await authed('/api/v1/device/push-token', {
      method: 'POST',
      // fullScreen: this build rings Urgent alerts like a call (1.0.14+), so the
      // server may send them as data-only pushes (lib/urgent).
      body: JSON.stringify({ token, deviceName: (Platform.constants as { Model?: string }).Model ?? null, fullScreen: canRingFullScreen() }),
    });
  } catch {
    // No Firebase in this build yet, no network, or permission refused - try again next open.
  }
}
