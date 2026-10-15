import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmSignOut } from '@/lib/signout';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Button, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BrandMark } from '@/components/BrandMark';
import { authed } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { takePendingPath } from '@/lib/push';
import { radius, space } from '@/theme/tokens';

/**
 * "Open the full website" from the owner's home (13 Oct 2026: the owner's
 * home is now a native screen - owner/home - and this is one tap away).
 * `?next=/path` opens that page.
 *
 * The owner's view - the whole platform, inside the app (decided 24 Sep:
 * website-in-app for v1). The app trades its token for a one-time link
 * (/api/v1/auth/web-link, single use, two minutes), so the website opens
 * already signed in on the same store - never a second login.
 *
 * The phone's back button goes back inside the website first, and only
 * leaves the screen when there is no page to go back to.
 *
 * LOADING (5 Oct 2026). Pages used to stay hidden behind "Opening your
 * business…" until a refresh. The full-screen cover was raised on every
 * onLoadStart and lowered on onLoadEnd - but the website is a single-page app,
 * and moving between its pages often fires the start without the end. The page
 * had opened; the cover simply never came down. Now the cover is shown only
 * until the FIRST page has loaded; after that a thin progress line at the top
 * shows activity without ever hiding the page, and a timer lowers anything
 * still showing after 8 seconds whatever the events say.
 */
export default function OwnerWebsite() {
  const { c } = useTheme();
  const { t } = useT();
  const web = useRef<WebView>(null);
  const canBack = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Has the first page finished? After that the full-screen cover never returns. */
  const [ready, setReady] = useState(false);
  /** 0..1 while a page loads; null when idle. Drawn as a thin line, never a cover. */
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const params = useLocalSearchParams<{ next?: string }>();
  const asked = typeof params.next === 'string' && params.next.startsWith('/') && !params.next.startsWith('//') ? params.next : null;

  // Safety net: whatever the WebView events do, nothing stays showing for more
  // than 8 seconds.
  useEffect(() => {
    if (!loading && progress === null) return;
    const t = setTimeout(() => { setLoading(false); setProgress(null); setReady(true); }, 8000);
    return () => clearTimeout(t);
  }, [loading, progress]);

  const open = useCallback(async () => {
    setFailed(null);
    setLoading(true);
    const s = await loadSession();
    if (!s || s.kind !== 'user') { router.replace('/welcome'); return; }
    try {
      // A tapped notification asks for its page (the website checks it is one of its own).
      const next = asked ?? takePendingPath();
      const r = await authed<{ url: string }>('/api/v1/auth/web-link', { method: 'POST', body: JSON.stringify(next ? { next } : {}) });
      if (!r) { router.replace('/welcome'); return; }
      setUrl(r.url);
    } catch (e) {
      setFailed(e instanceof Error ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
      setLoading(false);
    }
  }, [t, asked]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- an async load; state is set when it resolves
  useEffect(() => { void open(); }, [open]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canBack.current) { web.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <Screen edges={['top']} style={{ backgroundColor: c.hero }}>
      <View style={[styles.bar, { backgroundColor: c.hero }]}>
        {/* Back to the owner's home (native). */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('Home')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/owner/home'))} hitSlop={10} style={styles.barBtn}>
          <Icon name="home" size={20} color={c.heroInk} />
        </Pressable>
        <View style={{ flex: 1 }}><BrandMark onDark color={c.heroInk} size={22} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Refresh')} onPress={() => (url ? web.current?.reload() : open())} hitSlop={10} style={styles.barBtn}>
          <Icon name="refresh" size={20} color={c.heroInk} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Sign out')}
          onPress={() => { void confirmSignOut(t); }}
          hitSlop={10}
          style={styles.barBtn}
        >
          <Icon name="logout" size={20} color={c.heroInk} />
        </Pressable>
      </View>

      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {url && !failed && (
          <WebView
            ref={web}
            source={{ uri: url }}
            style={{ flex: 1, backgroundColor: c.bg }}
            onLoadStart={() => { if (!ready) setLoading(true); setProgress(0.05); }}
            onLoadProgress={(e) => setProgress(e.nativeEvent.progress >= 1 ? null : e.nativeEvent.progress)}
            onLoadEnd={() => { setLoading(false); setReady(true); setProgress(null); }}
            onNavigationStateChange={(n) => { canBack.current = n.canGoBack; }}
            onError={() => { setFailed(t('Could not reach the server. Check the connection and try again.')); setLoading(false); setProgress(null); }}
            // Keep the website's scripts, styles and data between visits, so
            // reopening the app does not download everything again.
            cacheEnabled
            domStorageEnabled
            cacheMode="LOAD_DEFAULT"
            // The website's own session cookie lives in the web view; the
            // one-time link set it. Nothing else is shared with the page.
            sharedCookiesEnabled
            pullToRefreshEnabled
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
          />
        )}

        {progress !== null && ready && !failed && (
          <View pointerEvents="none" style={[styles.progressTrack, { backgroundColor: c.bg }]}>
            <View style={[styles.progressBar, { backgroundColor: c.brand, width: `${Math.max(5, Math.round(progress * 100))}%` }]} />
          </View>
        )}

        {loading && !ready && !failed && (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.bg }]}>
            <ActivityIndicator color={c.brand} size="large" />
            <Text color={c.inkSoft} style={{ marginTop: space.md }}>{t('Opening your business…')}</Text>
          </View>
        )}

        {failed && (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.bg, padding: space.xl }]}>
            <View style={[styles.badge, { backgroundColor: c.dangerSoft }]}>
              <Icon name="alert" size={28} color={c.danger} />
            </View>
            <Text variant="h3" weight="bold" align="center" style={{ marginTop: space.lg }}>{t('No connection')}</Text>
            <Text color={c.inkSoft} align="center" style={{ marginTop: space.xs, marginBottom: space.xl }}>{failed}</Text>
            <Button label={t('Try again')} onPress={open} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.sm },
  barBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  progressBar: { height: 3 },
  badge: { width: 64, height: 64, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center' },
});
