import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Card, Text } from './ui';
import { Icon } from './Icon';
import { font, radius, space } from '@/theme/tokens';
import { loadToday, onShift, punch, takeNotice, type Today } from '@/lib/attendance';
import { isTracking, startTracking, stopTracking } from '@/lib/tracking';
import { syncCalls } from '@/lib/calls';
import { Scanner } from './Scanner';

/**
 * Clock in / clock out - the one thing every employee opens the app for.
 * A big, calm button; the running time of the shift; and plain notes when
 * something is waiting for a signal or was refused.
 *
 * THE PHOTO (F2.5, decision D14). Where the owner has switched selfies on, the
 * front camera opens first and the picture travels with the punch. It is not a
 * face scan: nothing is enrolled and nothing is matched, so a bad light or a
 * new haircut can never lock somebody out of their own shift.
 *
 * Two refusals, two different answers, and the difference is deliberate:
 *
 *  - The person closes the camera. Nothing happens - they pressed back, and
 *    they can press the button again.
 *  - The PHONE refuses the camera (permission denied at the OS). They are
 *    clocked in anyway, and told the photo could not be taken. Refusing to let
 *    somebody start work over a camera permission is the same mistake as
 *    refusing a clock-in for a poor GPS fix, which attendance-geo.ts has
 *    avoided since September.
 */

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

function duration(fromIso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * trackLocation: Settings > Roles > Phone app "Location tracking during shift".
 * requireSelfie: Settings > Roles > Phone app "Photo when clocking in".
 */
export function AttendanceCard({ trackLocation = true, requireSelfie = false }: { trackLocation?: boolean; requireSelfie?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  const [today, setToday] = useState<Today | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [working, setWorking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState<{ tone: 'warning' | 'danger' | 'info'; text: string } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [localIn, setLocalIn] = useState<number | null>(null);
  const [on, setOn] = useState(false);
  /** Which punch is waiting for a photograph, and so whether the camera is open. */
  const [selfieFor, setSelfieFor] = useState<'in' | 'out' | null>(null);
  /**
   * The camera answered - with a picture, or with a refusal. `Scanner` calls
   * `onClose` after `onPhoto` as well, and only this tells the two apart: an
   * unanswered close means the person backed out, and nothing should happen.
   */
  const answered = useRef(false);

  const refresh = useCallback(async () => {
    const r = await loadToday();
    setToday(r.today);
    setPendingCount(r.pending.length);
    setOffline(r.offline);
    const last = r.pending[r.pending.length - 1];
    setLocalIn(last?.action === 'in' ? last.clientTime : null);
    const shift = onShift(r.today, r.pending);
    setOn(shift);
    // The service follows the shift - restart it if Android stopped it, stop it if the shift ended elsewhere.
    if (shift && trackLocation) setTracking(await startTracking(t));
    else { if (await isTracking()) await stopTracking(); setTracking(false); }
    const n = await takeNotice();
    if (n) setNote({ tone: 'danger', text: `${t('A clock-in sent later was refused:')} ${t(n)}` });
    setLoaded(true);
  }, [t, trackLocation]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an async load; state is set when it resolves
    void refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [refresh]);

  const since = localIn ? new Date(localIn).toISOString() : today?.openSince ?? null;

  /** The button. With selfies on, the camera comes first and `run` waits for it. */
  const act = () => {
    if (working || selfieFor) return;
    const action = on ? 'out' : 'in';
    if (requireSelfie) {
      setNote(null);
      answered.current = false;
      setSelfieFor(action);
      return;
    }
    void run(action, null, false);
  };

  const run = async (action: 'in' | 'out', photo: string | null, cameraRefused: boolean) => {
    if (working) return;
    setWorking(true);
    setNote(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (action === 'out') void syncCalls();
    const r = await punch(action, photo);
    if (r.kind === 'blocked') setNote({ tone: 'danger', text: t(r.message) });
    else if (r.kind === 'refused') setNote({ tone: 'warning', text: t(r.message) });
    else if (r.kind === 'unpaired') setNote({ tone: 'danger', text: t('This phone is no longer paired. Ask your admin for a new pairing code.') });
    else {
      if (r.kind === 'queued') setNote({ tone: 'info', text: t('No signal - saved on the phone with the correct time. It will be sent automatically.') });
      else if (cameraRefused) setNote({ tone: 'warning', text: t('Saved without a photo - the camera is switched off for this app. Allow the camera in phone settings.') });
      if (action === 'in' && trackLocation) setTracking(await startTracking(t));
      else await stopTracking();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    await refresh();
    setWorking(false);
  };

  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = on ? withRepeat(withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })), -1) : 1;
  }, [on, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const noteColors = note?.tone === 'danger' ? [c.dangerSoft, c.danger] : note?.tone === 'warning' ? [c.warningSoft, c.warning] : [c.brandSoft, c.brand];

  return (
    <Card style={{ gap: space.lg, padding: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: on ? c.success : c.muted }, dot]} />
        <Text variant="small" weight="semibold" color={on ? c.success : c.inkSoft} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {!loaded ? t('Attendance') : on ? t('On shift') : today?.status === 'completed' ? t('Shift ended') : t('Not clocked in')}
        </Text>
        <View style={{ flex: 1 }} />
        {offline && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="globe" size={14} color={c.warning} />
            <Text variant="micro" color={c.warning}>{t('Offline')}</Text>
          </View>
        )}
      </View>

      <View style={{ gap: 2 }}>
        {on && since ? (
          <>
            <Text style={{ fontFamily: font.brand, fontSize: 44, lineHeight: 52 }} color={c.ink}>{duration(since, now)}</Text>
            <Text variant="small" color={c.inkSoft}>{t('Clocked in at')} {hhmm(since)}</Text>
          </>
        ) : today?.status === 'completed' ? (
          <>
            <Text style={{ fontFamily: font.brand, fontSize: 44, lineHeight: 52 }} color={c.ink}>
              {`${Math.floor((today.workedMinutes ?? 0) / 60)}h ${String((today.workedMinutes ?? 0) % 60).padStart(2, '0')}m`}
            </Text>
            <Text variant="small" color={c.inkSoft}>
              {today.firstInAt ? hhmm(today.firstInAt) : '--'} - {today.lastOutAt ? hhmm(today.lastOutAt) : '--'} · {t('worked today')}
            </Text>
          </>
        ) : (
          <>
            <Text variant="h2" weight="bold">{t('Start your day')}</Text>
            <Text variant="small" color={c.inkSoft}>
              {requireSelfie
                ? t('A photo and your location are recorded when you clock in, and your location during your shift.')
                : t('Your location is recorded once when you clock in, and during your shift.')}
            </Text>
          </>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? t('Clock out') : t('Clock in')}
        disabled={working || !loaded}
        onPress={act}
        style={({ pressed }) => ({
          height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm,
          backgroundColor: on ? c.surface : c.brand, borderWidth: on ? 1.5 : 0, borderColor: c.danger,
          opacity: pressed || working ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }],
        })}
      >
        {working ? <ActivityIndicator color={on ? c.danger : c.brandInk} /> : <Icon name={on ? 'logout' : 'clock'} size={22} color={on ? c.danger : c.brandInk} />}
        <Text variant="h3" weight="bold" color={on ? c.danger : c.brandInk}>{on ? t('Clock out') : today?.status === 'completed' ? t('Clock in again') : t('Clock in')}</Text>
      </Pressable>

      {note && (
        <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: noteColors[0] }}>
          <Icon name="alert" size={18} color={noteColors[1]} />
          <Text variant="small" style={{ flex: 1 }}>{note.text}</Text>
        </View>
      )}

      {/**
        * `quality` is lower than the rest of the app on purpose: this picture
        * may wait in the offline queue for hours, and a supervisor recognising
        * a face needs far less than an invoice being read by AI.
        */}
      <Scanner
        visible={selfieFor !== null}
        mode="photo"
        facing="front"
        quality={0.45}
        title={selfieFor === 'out' ? t('Photo to clock out') : t('Photo to clock in')}
        prompt={t('Allow the camera to take your attendance photo.')}
        onPhoto={(base64) => {
          answered.current = true;
          const action = selfieFor;
          setSelfieFor(null);
          if (action) void run(action, base64, false);
        }}
        onDeny={() => {
          answered.current = true;
          const action = selfieFor;
          setSelfieFor(null);
          if (action) void run(action, null, true);
        }}
        onClose={() => {
          // Backed out, so nothing happens - they can press the button again.
          setSelfieFor(null);
          answered.current = false;
        }}
      />

      {requireSelfie && !working && (
        <Row icon="camera" color={c.inkSoft} text={t('A photo is taken with the front camera.')} />
      )}

      {(pendingCount > 0 || on) && (
        <View style={{ gap: 6 }}>
          {pendingCount > 0 && (
            <Row icon="refresh" color={c.warning} text={t(`${pendingCount} waiting to be sent`)} />
          )}
          {on && (
            <Row
              icon="mapPin"
              color={tracking ? c.success : c.danger}
              text={tracking ? t('Location is being shared during your shift') : t('Location sharing is off - finish phone setup')}
            />
          )}
        </View>
      )}
    </Card>
  );
}

function Row({ icon, color, text }: { icon: 'refresh' | 'mapPin' | 'camera'; color: string; text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={16} color={color} />
      <Text variant="small" color={c.inkSoft}>{text}</Text>
    </View>
  );
}
