import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, PrefSwitches, Screen, Text } from '@/components/ui';
import { Empty, Loading, SectionLabel, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { SimpleNav } from '@/components/SimpleNav';
import { OfflineBar } from '@/components/OfflineBar';
import { myJobs, type ScheduleRow } from '@/lib/jobs';
import { useLayout } from '@/lib/layout';
import { radius, space } from '@/theme/tokens';

/**
 * SCHEDULE - the visits booked for this person (13 Oct 2026, decision 3):
 * its own screen, Today then Tomorrow, by time. Anything earlier that was
 * never done sits on top in red, so it is not quietly forgotten.
 */
export default function Schedule() {
  const { t } = useT();
  const { c } = useTheme();
  const { access } = useLayout();
  const load = useCallback(() => myJobs(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 30_000 });
  const [refreshing, setRefreshing] = useState(false);

  const by = (d: ScheduleRow['day']) => (data?.schedule ?? []).filter((v) => v.day === d)
    .filter((v) => (v.kind === 'complaint' ? access.layout.types.complaints : access.layout.types.installations));
  const open = (v: ScheduleRow) => (v.kind === 'complaint'
    ? router.push({ pathname: '/employee/complaint/[id]', params: { id: v.jobId } })
    : router.push({ pathname: '/employee/installation/[id]', params: { id: v.jobId } }));
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  const section = (title: string, rows: ScheduleRow[], late = false) => rows.length > 0 && (
    <View key={title} style={{ gap: space.sm }}>
      <SectionLabel>{title}</SectionLabel>
      {rows.map((v) => (
        <Pressable key={v.id} accessibilityRole="button" onPress={() => open(v)}
          style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: late ? 2 : 1, borderColor: late ? c.danger : c.line, backgroundColor: pressed ? c.brandSoft : c.surface })}>
          <View style={{ width: 72 }}>
            <Text variant="h3" weight="bold" color={late ? c.danger : c.brand}>{time(v.scheduledAt)}</Text>
            {late && <Text variant="micro" color={c.danger}>{new Date(v.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="bold" numberOfLines={1}>{v.customerName}</Text>
            <Text variant="small" color={c.inkSoft}>{`${t(v.kind === 'installation' ? 'Installation' : 'Complaint')} · ${v.no}`}</Text>
            {v.siteLocation ? <Text variant="small" color={c.inkSoft} numberOfLines={1}>{v.siteLocation}</Text> : null}
            {v.checkedIn && <Text variant="small" weight="semibold" color={c.success}>{t('Checked in')}</Text>}
          </View>
          <Icon name="arrowRight" size={20} color={c.muted} />
        </Pressable>
      ))}
    </View>
  );

  const earlier = by('earlier'), today = by('today'), tomorrow = by('tomorrow');
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('Schedule')}</Text>
        <PrefSwitches />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} colors={[c.brand]} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
      >
        <OfflineBar />
        {error && <Banner tone="danger">{error}</Banner>}
        {loading && !data ? <Loading /> : (
          <>
            {section(t('Missed - not done yet'), earlier, true)}
            {section(t('Today'), today)}
            {section(t('Tomorrow'), tomorrow)}
            {!earlier.length && !today.length && !tomorrow.length && (
              <Empty icon="calendar" title={t('No visits today or tomorrow')} line={t('Visits the office books for you appear here.')} />
            )}
          </>
        )}
      </ScrollView>
      <SimpleNav current="schedule" schedule={access.layout.schedule} />
    </Screen>
  );
}
