import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { Icon } from './Icon';
import { useNet } from '@/lib/net';
import { useOutboxCounts, waiting } from '@/lib/outbox';
import { radius, space } from '@/theme/tokens';

/**
 * The offline bar (F-13, 13 Oct 2026): on every screen, one line that says
 * there is no signal and how old the copy on screen is, and - signal or not -
 * how many changes are still waiting to go. Tap: the Waiting to send screen.
 * Shows nothing at all when online with nothing waiting.
 */
export function OfflineBar() {
  const { t } = useT();
  const { c } = useTheme();
  const net = useNet();
  const counts = useOutboxCounts();
  if (!net.offline && counts.waiting === 0 && counts.refused === 0) return null;
  const time = net.showingFrom ? new Date(net.showingFrom).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null;
  const parts = [
    net.offline ? (time ? `${t('No signal - showing')} ${time}` : t('No signal')) : null,
    counts.waiting ? `${counts.waiting} ${t('waiting to send')}` : null,
    counts.refused ? `${counts.refused} ${t('not accepted')}` : null,
  ].filter(Boolean);
  const bad = counts.refused > 0;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/outbox')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: bad ? c.dangerSoft : net.offline ? c.surface2 : c.warningSoft }}>
      <Icon name={bad ? 'alert' : net.offline ? 'eyeOff' : 'refresh'} size={16} color={bad ? c.danger : c.inkSoft} />
      <Text variant="small" weight="semibold" color={bad ? c.danger : c.ink} style={{ flex: 1 }}>{parts.join(' · ')}</Text>
      <Icon name="arrowRight" size={16} color={c.muted} />
    </Pressable>
  );
}

/** "2 changes on this job are waiting to send" - for one record's screen. */
export function Waiting({ target }: { target: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const counts = useOutboxCounts();
  const [n, setN] = useState(0);
  useEffect(() => { void waiting(target).then((q) => setN(q.length)); }, [target, counts.waiting]);
  if (!n) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: c.warningSoft }}>
      <Icon name="clock" size={16} color={c.warning} />
      <Text variant="small" weight="semibold" style={{ flex: 1 }}>{`${n} ${t('change(s) here waiting to send')}`}</Text>
    </View>
  );
}
