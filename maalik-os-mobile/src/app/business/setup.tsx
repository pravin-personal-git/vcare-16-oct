import { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Card, PrefSwitches, Screen, Text } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import {
  allGood, hasAutostartScreen, openAutostartSettings, openBatterySettings, openLocationSettings,
  readPermissionState, requestCallLog, requestLocation, requestNotifications, type PermissionState,
} from '@/lib/permissions';
import { checkIn, startBackgroundCheckIns } from '@/lib/checkin';
import { canRingFullScreen, fullScreenAllowed, openFullScreenSettings } from '@/lib/urgent';
import { radius, space } from '@/theme/tokens';

/**
 * Phone setup after pairing - consent first, then each permission, then the
 * battery settings that decide whether tracking survives on this brand.
 *
 * Google requires the "prominent disclosure" (step 1) before location or call
 * log is requested, in the app, with an explicit choice. Every step shows its
 * live state and re-checks when the person comes back from Settings, so the
 * screen never claims something is done that is not.
 */

const CONSENT_KEY = 'maalik.consent.v1';

export default function PhoneSetup() {
  const { c } = useTheme();
  const { t } = useT();
  const [state, setState] = useState<PermissionState | null>(null);
  const [consented, setConsented] = useState(false);
  const [autostartDone, setAutostartDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => setState(await readPermissionState()), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an async load; state is set when it resolves
    void refresh();
    AsyncStorage.getItem(CONSENT_KEY).then((v) => setConsented(!!v)).catch(() => undefined);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); await refresh(); }
  };

  const agree = async () => {
    await AsyncStorage.setItem(CONSENT_KEY, new Date().toISOString()).catch(() => undefined);
    setConsented(true);
  };

  const finish = async () => {
    setBusy('finish');
    await checkIn();
    await startBackgroundCheckIns();
    setBusy(null);
    router.replace('/business/login');
  };

  const locationOk = !!state && state.location === 'always' && state.locationServices;
  const ready = consented && !!state && allGood(state);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.top}>
          <Text variant="h1" weight="bold" style={{ flex: 1 }}>{t('Set up this phone')}</Text>
          <PrefSwitches />
        </View>
        <Text color={c.inkSoft} style={{ marginTop: space.xs, marginBottom: space.lg }}>
          {t('Five quick steps so attendance, location and calls are recorded correctly.')}
        </Text>

        <Step
          n={1} icon="info" done={consented}
          title={t('How Vcare uses this phone')}
          body={t('While your shift is running - from clock-in to clock-out - Vcare records your location, even when the app is closed or not in use, to record attendance and site visits. It reads your call log (number, time and length - never the conversation) to record work calls. Nothing is collected outside your shift. This information is shared with your employer.')}
        >
          {!consented && <Button label={t('I understand and agree')} onPress={agree} />}
        </Step>

        <Step
          n={2} icon="mapPin" done={locationOk} locked={!consented}
          title={t('Location - "Allow all the time"')}
          body={t('Needed to record where you clock in and your route during the shift. Android will open Settings: choose "Allow all the time".')}
        >
          {consented && state && !locationOk && (
            state.location === 'always' && !state.locationServices
              ? <Button label={t('Turn on location')} variant="secondary" onPress={() => act('gps', openLocationSettings)} />
              : <Button label={t('Allow location')} loading={busy === 'loc'} onPress={() => act('loc', requestLocation)} />
          )}
        </Step>

        <Step
          n={3} icon="phone" done={!!state?.callLog} locked={!consented}
          title={t('Call log')}
          body={t('Who you called and for how long, matched to customers and leads. No call is ever recorded.')}
        >
          {consented && state && !state.callLog && (
            <Button label={t('Allow call log')} loading={busy === 'call'} onPress={() => act('call', requestCallLog)} />
          )}
        </Step>

        <Step
          n={4} icon="message" done={!!state?.notifications} locked={!consented}
          title={t('Notifications')}
          body={t('For new jobs, and the notice that shows while your shift is being recorded.')}
        >
          {consented && state && !state.notifications && (
            <Button label={t('Allow notifications')} loading={busy === 'notif'} onPress={() => act('notif', requestNotifications)} />
          )}
          {/* Android 14+ asks separately for call-style Urgent alerts. Not required to finish. */}
          {consented && state?.notifications && canRingFullScreen() && !fullScreenAllowed() && (
            <>
              <Text variant="small" color={c.inkSoft}>{t('Urgent approvals can ring like a call over the lock screen. Allow full-screen alerts for Vcare.')}</Text>
              <Button label={t('Allow full-screen alerts')} variant="secondary" onPress={() => act('fs', async () => openFullScreenSettings())} />
            </>
          )}
        </Step>

        <Step
          n={5} icon="refresh" done={!!state?.batteryUnrestricted && (!hasAutostartScreen() || autostartDone)} locked={!consented}
          title={t('Battery - keep Vcare running')}
          body={t('Phones close apps to save battery, which stops attendance and location. Set Vcare to "Unrestricted" / "Don\'t optimise".')}
        >
          {consented && state && !state.batteryUnrestricted && (
            <Button label={t('Open battery settings')} variant="secondary" onPress={() => act('bat', openBatterySettings)} />
          )}
          {consented && hasAutostartScreen() && !autostartDone && (
            <>
              <Text variant="small" color={c.inkSoft}>{t('This phone also has an "Auto-start" setting. Turn it on for Vcare.')}</Text>
              <Button label={t('Open auto-start settings')} variant="secondary" onPress={() => act('auto', openAutostartSettings)} />
              <Button label={t('I have turned on auto-start')} variant="ghost" onPress={() => setAutostartDone(true)} />
            </>
          )}
        </Step>

        {!ready && consented && (
          <Banner tone="warning">{t('Finish the steps above. Your admin sees on the Phones page when anything is off.')}</Banner>
        )}
        <Button label={t('Finish setup')} icon="arrowRight" onPress={finish} disabled={!ready} loading={busy === 'finish'} style={{ marginTop: space.md }} />
      </ScrollView>
    </Screen>
  );
}

function Step({ n, icon, title, body, done, locked = false, children }: {
  n: number; icon: IconName; title: string; body: string; done: boolean; locked?: boolean; children?: React.ReactNode;
}) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Card style={{ marginBottom: space.md, gap: space.md, opacity: locked ? 0.5 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={[styles.badge, { backgroundColor: done ? c.successSoft : c.brandSoft }]}>
          <Icon name={done ? 'check' : icon} size={22} color={done ? c.success : c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="micro" weight="semibold" color={c.muted}>{t(`Step ${n}`)}</Text>
          <Text weight="bold">{title}</Text>
        </View>
        <Text variant="small" weight="semibold" color={done ? c.success : c.warning}>{done ? t('Done') : t('Needed')}</Text>
      </View>
      <Text variant="small" color={c.inkSoft}>{body}</Text>
      {!done && children}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingBottom: space.xxxl },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
