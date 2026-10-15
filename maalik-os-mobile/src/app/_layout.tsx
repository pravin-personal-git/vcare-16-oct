import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold, Mukta_700Bold } from '@expo-google-fonts/mukta';
import { Sora_300Light, Sora_700Bold } from '@expo-google-fonts/sora';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { loadPrefs, type Lang, type ThemeMode } from '@/lib/prefs';
import { loadBrand, type Brand } from '@/lib/brand';
// Registers the background check-in task at startup - Android may launch the
// app in the background just to run it, so it must be defined here.
import { checkIn } from '@/lib/checkin';
// Same for the shift location task and the offline punch queue.
import '@/lib/tracking';
import { flushPunches } from '@/lib/attendance';
import { syncCalls } from '@/lib/calls';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
// Phone notifications (27 Sep 2026): the handler is set when this loads.
import { isHomeReady, registerForPush, rememberTap, takePendingJob, takePendingPath } from '@/lib/push';
// Call-style Urgent alerts (6 Oct 2026): defines the background push task at startup.
import { takeAlertHref } from '@/lib/urgent';
import { loadSession } from '@/lib/session';
import { flushJobQueue } from '@/lib/jobQueue';
// Alarm-style reminders (G-40, 13 Oct 2026): the phone's own alarms follow the server's list.
import { syncAlarms } from '@/lib/reminders';
import { flushUploads } from '@/lib/uploads';
import { flushOutbox } from '@/lib/outbox';
import { prefetchForOffline } from '@/lib/prefetch';

// Hold the native splash (the plain logo on the hero colour) until fonts and
// preferences are ready, so the animated intro never appears in the wrong
// font, language or theme for a frame.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold, Mukta_700Bold, Sora_300Light, Sora_700Bold,
  });
  const [prefs, setPrefs] = useState<{ theme: ThemeMode; lang: Lang; brand: Brand | null } | null>(null);

  useEffect(() => {
    void Promise.all([loadPrefs(), loadBrand()]).then(([p, brand]) => setPrefs({ ...p, brand }));
  }, []);

  // Check in whenever the app comes to the front (does nothing until paired).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { void checkIn(); void flushPunches(); void flushJobQueue(); void syncCalls(); void registerForPush(); void syncAlarms(); void flushUploads(); void flushOutbox(); void prefetchForOffline(); } });
    void registerForPush();
    void syncAlarms();
    void flushOutbox();
    // F-13: while there is signal, keep sending what waits and downloading what may be needed offline.
    const tick = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void flushJobQueue(); void flushOutbox(); void flushUploads(); void prefetchForOffline();
    }, 30_000);
    return () => { sub.remove(); clearInterval(tick); };
  }, []);

  // A tapped notification: the owner / full-website view opens that page;
  // everyone else lands on their home.
  useEffect(() => {
    const go = async (data: unknown) => {
      rememberTap(data);
      const s = await loadSession();
      /**
       * Tapped an Urgent alert with nobody signed in (F-05, 10 Oct 2026).
       *
       * The server sends these with no business detail in them - only that
       * something is waiting - so there is nothing to open and nowhere to go
       * but the sign-in screen. It used to fall through and leave the person
       * on whatever screen the app happened to show, which reads as the alert
       * having done nothing.
       */
      if (!s) { router.replace('/welcome'); return; }
      if (s.kind !== 'user') return;
      if (s.home === 'owner') {
        // The owner's home is native now (13 Oct 2026); a page the notification
        // names opens in the full website over it.
        router.replace('/owner/home');
        const next = takePendingPath();
        if (next) setTimeout(() => router.push({ pathname: '/owner/web', params: { next } }), 50);
        return;
      }
      router.replace('/employee/home');
      // A job notification opens that job over the home screen (Back returns
      // home). On a cold start the home screen opens it after the intro.
      if (isHomeReady()) {
        const id = takePendingJob();
        if (id) setTimeout(() => router.push({ pathname: '/employee/complaint/[id]', params: { id } }), 50);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) void go(r.notification.request.content.data); }).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => { void go(r.notification.request.content.data); });
    // "Open" on a full-screen Urgent alert: the native card saved where to go.
    const fromAlert = () => { const href = takeAlertHref(); if (href) void go({ href }); };
    fromAlert();
    const app = AppState.addEventListener('change', (st) => { if (st === 'active') fromAlert(); });
    return () => { sub.remove(); app.remove(); };
  }, []);

  // A font that fails to load must not strand the app on the splash - the
  // system font is an acceptable fallback, a frozen screen is not.
  const ready = (fontsLoaded || !!fontError) && prefs !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider initial={prefs.theme} initialBrand={prefs.brand}>
        <I18nProvider initial={prefs.lang}>
          <Shell />
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { c, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade_from_bottom',
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
      </Stack>
    </>
  );
}
