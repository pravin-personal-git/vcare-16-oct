import { Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';

/**
 * What the phone allows Vcare to do, read and requested.
 *
 * The same shape the server keeps (atlas-app lib/device-trust
 * PermissionState), so a check-in reports it as-is and the Phones screen can
 * flag "Location off" or "Battery restricted" the moment it happens.
 */
export interface PermissionState {
  location: 'always' | 'foreground' | 'denied';
  locationServices: boolean;
  callLog: boolean;
  notifications: boolean;
  batteryUnrestricted: boolean;
}

const android = Platform.OS === 'android';

async function androidGranted(p: string): Promise<boolean> {
  if (!android) return false;
  try { return await PermissionsAndroid.check(p as never); } catch { return false; }
}

export async function readPermissionState(): Promise<PermissionState> {
  const [fg, bg, services, callLog, notifications, optimised] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    Location.hasServicesEnabledAsync().catch(() => false),
    androidGranted(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
    // Android 12 and older grant notifications without asking.
    Platform.OS === 'android' && Number(Platform.Version) < 33
      ? Promise.resolve(true)
      : androidGranted(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
    android ? Battery.isBatteryOptimizationEnabledAsync().catch(() => true) : Promise.resolve(false),
  ]);
  return {
    location: bg?.granted ? 'always' : fg?.granted ? 'foreground' : 'denied',
    locationServices: !!services,
    callLog,
    notifications,
    batteryUnrestricted: !optimised,
  };
}

/**
 * Location in two steps, as Android requires: "while using the app" first,
 * then "all the time" - which on Android 11+ opens the system Settings page,
 * so the setup screen explains it before this is called.
 */
export async function requestLocation(): Promise<PermissionState['location']> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted ? 'always' : 'foreground';
}

export async function requestCallLog(): Promise<boolean> {
  if (!android) return false;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestNotifications(): Promise<boolean> {
  if (!android || Number(Platform.Version) < 33) return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function openLocationSettings() {
  if (android) await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS).catch(() => Linking.openSettings());
}

export async function openAppSettings() {
  await Linking.openSettings();
}

/**
 * Battery optimisation: the list where the user switches Vcare to "Don't
 * optimise" / "Unrestricted". The Play-safe route - the settings list, not
 * the one-tap exemption prompt Google restricts.
 */
export async function openBatterySettings() {
  if (!android) return;
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    .catch(() => Linking.openSettings());
}

/**
 * Brand "auto-start" screens. Xiaomi, Oppo, Vivo, Realme and some Samsung
 * phones kill background apps unless the app is allowed to auto-start - the
 * single most common reason tracking stops. Each maker hides it somewhere
 * different; where the exact screen is not available, the app's own settings
 * page opens instead.
 */
const AUTOSTART: Record<string, { pkg: string; cls: string }[]> = {
  xiaomi: [{ pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  redmi: [{ pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  poco: [{ pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  oppo: [
    { pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { pkg: 'com.oppo.safe', cls: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
  ],
  realme: [{ pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' }],
  vivo: [
    { pkg: 'com.vivo.permissionmanager', cls: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
    { pkg: 'com.iqoo.secure', cls: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
  ],
  oneplus: [{ pkg: 'com.oneplus.security', cls: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' }],
  samsung: [{ pkg: 'com.samsung.android.lool', cls: 'com.samsung.android.sm.ui.battery.BatteryActivity' }],
};

export function phoneBrand(): string {
  const c = Platform.constants as { Manufacturer?: string; Brand?: string };
  return String(c.Manufacturer ?? c.Brand ?? '').toLowerCase();
}

export function hasAutostartScreen(): boolean {
  return Object.keys(AUTOSTART).some((b) => phoneBrand().includes(b));
}

export async function openAutostartSettings() {
  const brand = Object.keys(AUTOSTART).find((b) => phoneBrand().includes(b));
  for (const t of brand ? AUTOSTART[brand] : []) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', { packageName: t.pkg, className: t.cls });
      return;
    } catch { /* try the next known screen */ }
  }
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
    data: `package:${Application.applicationId}`,
  }).catch(() => Linking.openSettings());
}

export function allGood(s: PermissionState): boolean {
  return s.location === 'always' && s.locationServices && s.callLog && s.notifications && s.batteryUnrestricted;
}
