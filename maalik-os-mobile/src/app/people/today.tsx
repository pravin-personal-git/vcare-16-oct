import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, useLoad } from '@/components/Kit';
import { teamToday, type TeamPerson } from '@/lib/people';
import { radius, space } from '@/theme/tokens';

/**
 * TEAM TODAY on the phone (13 Oct 2026, native admin app part 5): who is on
 * shift, finished, not marked yet, or on leave - with clock-in time, hours,
 * and a flag when someone clocked in outside the allowed places or with a
 * fake location. Leave requests are decided on Approvals.
 */
type Chip = 'all' | TeamPerson['status'];
const LABEL: Record<TeamPerson['status'], string> = { on_shift: 'On shift', done: 'Finished', not_marked: 'Not marked', on_leave: 'On leave' };
const TONE: Record<TeamPerson['status'], 'success' | 'brand' | 'warning' | 'neutral'> = { on_shift: 'success', done: 'brand', not_marked: 'warning', on_leave: 'neutral' };

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null);

export default function TeamToday() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => teamToday(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [chip, setChip] = useState<Chip>('all');
  const people = data?.people ?? [];
  const rows = people.filter((p) => chip === 'all' || p.status === chip);
  const count = (k: Chip) => (k === 'all' ? people.length : people.filter((p) => p.status === k).length);

  return (
    <SubScreen title={t('Team today')} subtitle={data ? `${count('on_shift')} ${t('on shift')} · ${count('not_marked')} ${t('not marked')}` : undefined} onRefresh={reload}
      list={{ data: rows, key: (p) => p.userId, render: (p) => {
          const leave = data?.onLeave.find((l) => l.userId === p.userId);
          const flags = [p.inWithinPolicy === false ? t('outside the allowed place') : null, p.mockedToday > 0 ? t('fake location') : null].filter(Boolean);
          return (
            <Row key={p.userId} title={p.name}
              line={p.status === 'on_leave' && leave ? `${t(leave.type)} · ${t('till')} ${new Date(leave.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : [time(p.firstInAt) ? `${t('In')} ${time(p.firstInAt)}` : null, time(p.lastOutAt) ? `${t('Out')} ${time(p.lastOutAt)}` : null,
                  p.workedMinutes ? `${Math.floor(p.workedMinutes / 60)}h ${p.workedMinutes % 60}m` : null].filter(Boolean).join(' · ') || t('No clock-in yet')}
              meta={flags.length ? flags.join(' · ') : undefined}
              right={<Pill label={t(LABEL[p.status])} tone={flags.length ? 'danger' : TONE[p.status]} />} />
          );
        } }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {(['all', 'on_shift', 'not_marked', 'done', 'on_leave'] as Chip[]).map((k) => {
          const on = chip === k;
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => setChip(k)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${k === 'all' ? t('Everyone') : t(LABEL[k])} ${data ? count(k) : ''}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : rows.length === 0
        ? <Empty icon="user" title={t('Nobody here')} />
        : null}
      <View style={{ gap: space.sm }}>
        <Pressable onPress={() => router.push('/employee/approvals')} style={{ paddingVertical: space.sm }}>
          <Text variant="small" weight="semibold" color={c.brand} align="center">{t('Leave waiting for approval')}</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/owner/web', params: { next: '/attendance/team-today' } })} style={{ paddingVertical: space.sm }}>
          <Text variant="small" weight="semibold" color={c.brand} align="center">{t('Map and full attendance on website')}</Text>
        </Pressable>
      </View>
    </SubScreen>
  );
}
