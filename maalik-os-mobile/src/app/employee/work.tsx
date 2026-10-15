import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, PrefSwitches, Screen, Text } from '@/components/ui';
import { Empty, Loading, useLoad } from '@/components/Kit';
import { Icon, type IconName } from '@/components/Icon';
import { SimpleNav } from '@/components/SimpleNav';
import { OfflineBar } from '@/components/OfflineBar';
import { UpdateBanner } from '@/components/UpdateBanner';
import { myJobs, type WorkRow } from '@/lib/jobs';
import { useLayout } from '@/lib/layout';
import { markHomeReady, takePendingJob } from '@/lib/push';
import { radius, space } from '@/theme/tokens';

/**
 * MY WORK - the simple field-worker app (13 Oct 2026, HANDOFF-2026-10-13
 * §4.2, decisions 1-4). Complaints and installation jobs given to this
 * person, in ONE list with a small tag; filters Today and Pending only (the
 * owner can add This week / All in the layout); late jobs on top in red;
 * finished jobs simply leave. Big text and Hindi first. Nothing else.
 */
type Filter = 'today' | 'pending' | 'week' | 'all';

export const toneOf = (status: string, kind: WorkRow['kind']): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' => {
  if (kind === 'installation') return status === 'pending' ? 'brand' : 'success';
  if (['assigned', 'received'].includes(status)) return 'warning';
  if (['on_the_way', 'on_site', 'in_progress'].includes(status)) return 'success';
  if (['awaiting_estimate', 'awaiting_customer'].includes(status)) return 'neutral';
  return 'brand';
};
export const iconOf = (status: string, kind: WorkRow['kind']): IconName => {
  if (kind === 'installation') return 'box';
  if (status === 'assigned' || status === 'received') return 'alert';
  if (status === 'scheduled' || status === 'accepted') return 'calendar';
  if (status === 'on_the_way') return 'navigation';
  if (status === 'on_site' || status === 'in_progress') return 'wrench';
  return 'clock';
};

export default function MyWork() {
  const { t } = useT();
  const { c } = useTheme();
  const { access, fresh } = useLayout();
  const L = access.layout;

  // Not on the simple layout (any more): the standard home.
  useEffect(() => { if (fresh && L.preset !== 'simple') router.replace('/employee/home'); }, [fresh, L.preset]);

  // A job notification tapped while the app was closed: open that job.
  useEffect(() => {
    markHomeReady();
    const id = takePendingJob();
    if (id) router.push({ pathname: '/employee/complaint/[id]', params: { id } });
  }, []);

  const filters = useMemo(() => ([
    L.filters.today && { key: 'today' as const, label: t('Today') },
    L.filters.pending && { key: 'pending' as const, label: t('Pending') },
    L.filters.week && { key: 'week' as const, label: t('This week') },
    L.filters.all && { key: 'all' as const, label: t('All') },
  ].filter(Boolean) as { key: Filter; label: string }[]), [L.filters, t]);
  const [filter, setFilter] = useState<Filter | null>(null);
  const active: Filter = filter && filters.some((f) => f.key === filter) ? filter : (filters[0]?.key ?? 'pending');

  const load = useCallback(() => myJobs(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 15_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [refreshing, setRefreshing] = useState(false);

  // The server's clock, from the same answer - not the phone's, which may be wrong.
  const weekEnd = (data ? Date.parse(data.now) : 0) + 7 * 86_400_000;
  const typed = (data?.jobs ?? []).filter((j) => (j.kind === 'complaint' ? L.types.complaints : L.types.installations));
  const rows = typed.filter((j) => active === 'today' ? j.today || j.late
    : active === 'week' ? j.late || (j.nextVisitAt !== null && Date.parse(j.nextVisitAt) < weekEnd)
      : true);
  const count = (f: Filter) => typed.filter((j) => f === 'today' ? j.today || j.late : f === 'week' ? j.late || (j.nextVisitAt !== null && Date.parse(j.nextVisitAt) < weekEnd) : true).length;
  const lateCount = typed.filter((j) => j.late).length;

  const open = (j: WorkRow) => (j.kind === 'complaint'
    ? router.push({ pathname: '/employee/complaint/[id]', params: { id: j.id } })
    : router.push({ pathname: '/employee/installation/[id]', params: { id: j.id } }));

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="h2" weight="bold">{t('My work')}</Text>
          {lateCount > 0 && <Text variant="small" weight="semibold" color={c.danger}>{`${lateCount} ${t('late')}`}</Text>}
        </View>
        <PrefSwitches />
      </View>
      {filters.length > 1 && (
        <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {filters.map((f) => {
            const on = f.key === active;
            return (
              <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setFilter(f.key)}
                style={{ flex: 1, minHeight: 48, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brand : c.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text weight="bold" color={on ? c.brandInk : c.ink}>{`${f.label}${data ? ` (${count(f.key)})` : ''}`}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} colors={[c.brand]} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
      >
        <OfflineBar />
        <UpdateBanner />
        {error && <Banner tone="danger">{error}</Banner>}
        {loading && !data ? <Loading /> : rows.length === 0
          ? <Empty icon="check" title={active === 'today' ? t('Nothing for today') : t('No open jobs')} line={t('Jobs the office gives you appear here.')} />
          : rows.map((j) => <JobCard key={`${j.kind}-${j.id}`} j={j} onPress={() => open(j)} />)}
      </ScrollView>
      <SimpleNav current="work" schedule={L.schedule} />
    </Screen>
  );
}

function JobCard({ j, onPress }: { j: WorkRow; onPress: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const tone = toneOf(j.status, j.kind);
  const col = j.late ? c.danger : { brand: c.brand, success: c.success, warning: c.warning, danger: c.danger, neutral: c.inkSoft }[tone];
  const soft = j.late ? c.dangerSoft : { brand: c.brandSoft, success: c.successSoft, warning: c.warningSoft, danger: c.dangerSoft, neutral: c.surface2 }[tone];
  const when = j.nextVisitAt ? new Date(j.nextVisitAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: j.late ? 2 : 1, borderColor: j.late ? c.danger : c.line, backgroundColor: pressed ? c.brandSoft : c.surface, padding: space.lg, gap: space.xs })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={j.late ? 'alert' : iconOf(j.status, j.kind)} size={22} color={col} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="bold" numberOfLines={1}>{j.customerName}</Text>
          <Text variant="small" weight="semibold" color={col}>{t(j.statusLabel)}</Text>
        </View>
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: j.kind === 'installation' ? c.accentSoft : c.surface2 }}>
          <Text variant="micro" weight="semibold" color={j.kind === 'installation' ? c.accent : c.inkSoft}>{t(j.kind === 'installation' ? 'Installation' : 'Complaint')}</Text>
        </View>
      </View>
      <Text numberOfLines={2}>{j.problem}</Text>
      {j.siteLocation ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="mapPin" size={14} color={c.muted} />
          <Text variant="small" color={c.inkSoft} numberOfLines={1} style={{ flex: 1 }}>{j.siteLocation}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {when && <Text variant="small" weight="semibold" color={j.late ? c.danger : c.ink}>{`${t('Visit')}: ${when}`}</Text>}
        <Text variant="micro" color={c.muted} style={{ marginStart: 'auto' }}>{j.no}</Text>
      </View>
      {j.late && j.lateReason && <Text variant="small" weight="bold" color={c.danger}>{`${t('Late')} - ${t(j.lateReason)}`}</Text>}
    </Pressable>
  );
}
