import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { Platform } from 'react-native';
import { API_BASE } from './api';
import { androidId, deviceInfo, forgetDevice, loadDevice } from './device';
import { readPermissionState } from './permissions';
import { callSyncStatus, syncCalls } from './calls';

/**
 * The phone's check-in - "still here, and this is what I'm allowed to do".
 *
 * Silence between check-ins is what turns a phone "Not reporting" on the
 * website, and each check-in carries the permission and battery state, the
 * phone's clock (to catch a changed clock) and its ANDROID_ID (to catch a
 * reset or a swapped phone). It runs when the app opens, when it comes back
 * to the front, and in the background about every 15 minutes (the shortest
 * interval Android allows for this kind of task; during a shift the location
 * service adds more). It never throws - a failed check-in is simply retried.
 */

export type CheckInOutcome = 'ok' | 'not_paired' | 'must_repair' | 'offline';

export async function checkIn(onShift = false): Promise<CheckInOutcome> {
  const device = await loadDevice();
  if (!device) return 'not_paired';
  try {
    const res = await fetch(`${API_BASE}/api/v1/device/checkin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': device.token },
      body: JSON.stringify({
        androidId: androidId(),
        permissions: await readPermissionState(),
        clientTime: Date.now(),
        appVersion: deviceInfo().appVersion,
        onShift,
        // Where the last call sync stopped (27 Sep 2026) - shown on the Phones page.
        callSync: await callSyncStatus(),
      }),
    });
    if (res.status === 409 || res.status === 401) {
      // Switched off by the admin, replaced by a newer phone, or a different
      // phone altogether. The old pairing is no longer any good.
      await forgetDevice();
      return 'must_repair';
    }
    return res.ok ? 'ok' : 'offline';
  } catch {
    return 'offline';
  }
}

export const CHECKIN_TASK = 'maalik-os.checkin';

// Defined at module scope, as the task manager requires: Android can start the
// app in the background just to run this.
if (Platform.OS === 'android') {
  TaskManager.defineTask(CHECKIN_TASK, async () => {
    await checkIn();
    await syncCalls();
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

/** Start background check-ins (once paired). Safe to call repeatedly. */
export async function startBackgroundCheckIns(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(CHECKIN_TASK);
    if (!registered) await BackgroundTask.registerTaskAsync(CHECKIN_TASK, { minimumInterval: 15 });
  } catch { /* background tasks unavailable on this phone - foreground check-ins still run */ }
}
