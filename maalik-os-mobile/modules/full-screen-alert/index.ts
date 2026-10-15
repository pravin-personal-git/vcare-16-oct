import { requireOptionalNativeModule } from 'expo';

/**
 * Call-style Urgent alerts (6 Oct 2026) and alarm-style reminders (G-40,
 * 13 Oct 2026). An Urgent push (approval waiting, escalation) and every
 * personal reminder ring a full-screen card over the lock screen that stays
 * until a button is pressed. Reminders ring from the phone's OWN alarm-clock
 * alarm, set ahead of time - with no signal, with the app closed, after a
 * restart. Native code: modules/full-screen-alert/android.
 */
interface FullScreenAlertNative {
  /** Urgent: ring the card now. `href` is where Open goes. */
  show(id: string, title: string, body: string, href: string | null): boolean;
  /** A reminder's backup push: ring now unless this moment already rang. JSON AlarmSpec. Returns whether it rang. */
  ring?(json: string): boolean;
  /** Replace every reminder alarm with this list (JSON array of AlarmSpec). Returns how many are set. */
  sync?(json: string): number;
  /** Done / Snooze pressed on cards since last asked (JSON array), cleared as read. */
  takeActions?(): string;
  /** The alarms set right now (JSON array of AlarmSpec). */
  scheduled?(): string;
  setTone?(tone: string | null): boolean;
  getTone?(): string | null;
  previewTone?(tone: string): boolean;
  stopPreview?(): boolean;
  setLang?(lang: string): boolean;
  /** Android 14+: the person may have to allow full-screen alerts for this app. */
  canUseFullScreen(): boolean;
  /** Opens the system screen where full-screen alerts are allowed. */
  openFullScreenSettings(): boolean;
  canScheduleExact?(): boolean;
  openExactAlarmSettings?(): boolean;
  ignoresBatteryOptimisation?(): boolean;
  /** Where the last alert's Open button wanted to go, read once. */
  takeOpenedHref(): string | null;
}

/** What the phone needs to set one alarm. `key` is reminder:<id>:<moment>, shared with the server's push. */
export interface AlarmSpec {
  key: string;
  reminderId: string | null;
  atMs: number;
  title: string;
  body: string;
  tone: string | null;
  href: string | null;
  mode?: 'reminder' | 'urgent';
}

/** Null outside an Android build (web preview, Expo Go, older APKs). */
export const FullScreenAlert = requireOptionalNativeModule<FullScreenAlertNative>('MaalikFullScreenAlert');
