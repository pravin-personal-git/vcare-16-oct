import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, PrefSwitches, Screen, Text } from '@/components/ui';
import { Empty, Loading, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { OfflineBar } from '@/components/OfflineBar';
import { AssignSheet, type AssignTarget } from '@/components/AssignSheet';
import { officeJobs, type OfficeGroup, type OfficeJob } from '@/lib/owner';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * SERVICE - the office job board, native (13 Oct 2026, ADMIN-NATIVE-APP-SPEC
 * part 1). Every open complaint and installation in the branch: late ones
 * first in red, chips for Late / Nobody on it / To do / Working / Waiting,
 * a technician filter, search, and Assign right on the card. Tap a job for
 * its page. Works from the last copy with no signal; Assign goes through the
 * outbox.
 */
type Chip = 'all' | 'late' | OfficeGroup;

export default function ServiceBoard() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => officeJobs(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 30_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [refreshing, setRefreshing] = useState(false);
  const [chip, setChip] = useState<Chip>('all');
  const [tech, setTech] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'complaint' | 'installation'>('all');
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const inChip = (j: OfficeJob, k: Chip) => k === 'all' || (k === 'late' ? j.late : j.group === k);
  const base = jobs.filter((j) => (kind === 'all' || j.kind === kind) && (!tech || (tech === 'none' ? j.technicianIds.length === 0 : j.technicianIds.includes(tech))));
  const needle = q.trim().toLowerCase();
  const rows = base.filter((j) => inChip(j, chip) && (!needle
    || [j.no, j.customerName, j.problem, j.siteLocation ?? '', ...j.technicianNames].join(' ').toLowerCase().includes(needle)));
  const chips: { key: Chip; label: string; tone?: string }[] = [
    { key: 'all', label: t('All open') },
    { key: 'late', label: t('Late'), tone: c.danger },
    { key: 'unassigned', label: t('Nobody on it'), tone: c.warning },
    { key: 'todo', label: t('To do') },
    { key: 'working', label: t('Working'), tone: c.success },
    { key: 'waiting', label: t('Waiting') },
  ];
  const open = (j: OfficeJob) => (j.kind === 'complaint'
    ? router.push({ pathname: '/employee/complaint/[id]', params: { id: j.id } })
    : router.push({ pathname: '/employee/installation/[id]', params: { id: j.id } }));

  const pill = (on: boolean, label: string, press: () => void, key: string, tone?: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={press}
      style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? (tone ?? c.brand) : c.line, backgroundColor: on ? (tone ?? c.brand) : c.surface }}>
      <Text variant="small" weight="semibold" color={on ? '#fff' : (tone ?? c.ink)}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="h2" weight="bold">{t('Service')}</Text>
          {data && <Text variant="small" color={c.inkSoft}>{`${jobs.length} ${t('open')} · ${jobs.filter((j) => j.late).length} ${t('late')} · ${jobs.filter((j) => j.group === 'unassigned').length} ${t('nobody on it')}`}</Text>}
        </View>
        <PrefSwitches />
      </View>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={t('Search job, customer, area, technician')} placeholderTextColor={c.muted}
            style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
          {q ? <Pressable accessibilityRole="button" accessibilityLabel={t('Clear search')} onPress={() => setQ('')} hitSlop={10}><Icon name="x" size={18} color={c.muted} /></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {chips.map((x) => pill(chip === x.key, `${x.label}${data ? ` ${base.filter((j) => inChip(j, x.key)).length}` : ''}`, () => setChip(x.key), x.key, x.tone))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {pill(kind === 'all', t('Both'), () => setKind('all'), 'k-all')}
          {pill(kind === 'complaint', t('Complaints'), () => setKind('complaint'), 'k-c')}
          {pill(kind === 'installation', t('Installations'), () => setKind('installation'), 'k-i')}
          <View style={{ width: 1, backgroundColor: c.line, marginHorizontal: 4 }} />
          {pill(!tech, t('Everyone'), () => setTech(null), 't-all')}
          {pill(tech === 'none', t('Nobody'), () => setTech('none'), 't-none')}
          {(data?.technicians ?? []).map((p) => pill(tech === p.id, p.name.split(' ')[0] ?? p.name, () => setTech(p.id), `t-${p.id}`))}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} colors={[c.brand]} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
      >
        <OfflineBar />
        {error && <Banner tone="danger">{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        {loading && !data ? <Loading /> : rows.length === 0
          ? <Empty icon="check" title={chip === 'late' ? t('Nothing late') : t('No jobs here')} />
          : rows.map((j) => (
            <BoardCard key={`${j.kind}-${j.id}`} j={j} onOpen={() => open(j)}
              onAssign={data?.canAssign ? () => setAssigning({ kind: j.kind, id: j.id, no: j.no, customerName: j.customerName, technicianIds: j.technicianIds }) : undefined} />
          ))}
      </ScrollView>
      <AssignSheet job={assigning} people={data?.technicians ?? []} onClose={() => setAssigning(null)}
        onDone={(m) => { setAssigning(null); setNotice(m); void reload(); }} />
    </Screen>
  );
}

function BoardCard({ j, onOpen, onAssign }: { j: OfficeJob; onOpen: () => void; onAssign?: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const col = j.late ? c.danger : j.group === 'unassigned' ? c.warning : j.group === 'working' ? c.success : j.group === 'waiting' ? c.inkSoft : c.brand;
  const when = j.nextVisitAt ? new Date(j.nextVisitAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <Pressable accessibilityRole="button" onPress={onOpen}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: j.late ? 2 : 1, borderColor: j.late ? c.danger : c.line, backgroundColor: pressed ? c.brandSoft : c.surface, padding: space.md, gap: 4 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text weight="bold" numberOfLines={1} style={{ flex: 1 }}>{j.customerName}</Text>
        {(j.priority === 'urgent' || j.priority === 'high') && <Text variant="micro" weight="bold" color={c.danger}>{t('URGENT')}</Text>}
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: j.kind === 'installation' ? c.accentSoft : c.surface2 }}>
          <Text variant="micro" weight="semibold" color={j.kind === 'installation' ? c.accent : c.inkSoft}>{t(j.kind === 'installation' ? 'Installation' : 'Complaint')}</Text>
        </View>
      </View>
      <Text variant="small" numberOfLines={2}>{j.problem}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text variant="small" weight="semibold" color={col}>{t(j.statusLabel)}</Text>
        {when && <Text variant="small" color={j.late ? c.danger : c.inkSoft}>{`· ${t('Visit')} ${when}`}</Text>}
        <Text variant="micro" color={c.muted} style={{ marginStart: 'auto' }}>{j.no}</Text>
      </View>
      {j.late && j.lateReason && <Text variant="small" weight="bold" color={c.danger}>{`${t('Late')} - ${t(j.lateReason)}`}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 }}>
        <Icon name="user" size={14} color={j.technicianNames.length ? c.inkSoft : c.warning} />
        <Text variant="small" color={j.technicianNames.length ? c.inkSoft : c.warning} style={{ flex: 1 }} numberOfLines={1}>
          {j.technicianNames.length ? j.technicianNames.join(', ') : t('Nobody on it')}
        </Text>
        {onAssign && (
          <Pressable accessibilityRole="button" onPress={onAssign} hitSlop={8}
            style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand }}>
            <Text variant="small" weight="semibold" color={c.brand}>{j.technicianIds.length ? t('Change') : t('Assign')}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
