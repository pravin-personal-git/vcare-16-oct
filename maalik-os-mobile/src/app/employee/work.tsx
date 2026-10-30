import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, SectionList, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, PrefSwitches, Screen, Text } from '@/components/ui';
import { Loading, useLoad } from '@/components/Kit';
import { Icon, type IconName } from '@/components/Icon';
import { SimpleNav } from '@/components/SimpleNav';
import { OfflineBar } from '@/components/OfflineBar';
import { UpdateBanner } from '@/components/UpdateBanner';
import { Scanner } from '@/components/Scanner';
import { complaintAction, myJobs, searchJobs, type WorkRow } from '@/lib/jobs';
import { dialable } from '@/lib/access';
import { useLayout } from '@/lib/layout';
import { markHomeReady, takePendingJob } from '@/lib/push';
import { radius, space } from '@/theme/tokens';

/**
 * MY WORK - the field worker's one list (13 Oct 2026; rebuilt 28 Oct 2026,
 * Vcare). Five filters, each answering one question, in this order:
 *   New      "what did I just get?"      given, not accepted
 *   Today    "where do I go today?"      a visit booked today, or on site now
 *   Late     "what did I miss?"          only where the next move is theirs
 *   Waiting  "what is stuck elsewhere?"  estimate / customer confirmation
 *   All      every open job, grouped
 * and one search box on top - number (new or old), customer, phone, serial,
 * or scan - over their open and finished jobs, or the whole branch when the
 * role may see it. The server works out which filter a job is in
 * (lib/my-work), so every phone agrees.
 */
type Filter = 'new' | 'today' | 'late' | 'waiting' | 'all';
type Kind = 'all' | 'complaint' | 'installation';

/** Whose move it is - from the server, or worked out the old way for an older server. */
const stageOf = (j: WorkRow) => j.stage ?? (j.kind === 'installation' ? 'working'
  : ['received', 'assigned'].includes(j.status) ? 'new'
    : ['awaiting_estimate', 'awaiting_customer'].includes(j.status) ? 'waiting'
      : ['resolved', 'closed', 'cancelled'].includes(j.status) ? 'done' : 'working');
const isLate = (j: WorkRow) => j.late && (stageOf(j) === 'new' || stageOf(j) === 'working');
const isToday = (j: WorkRow) => j.today && stageOf(j) !== 'waiting' && stageOf(j) !== 'done';

const FILTERS: { key: Filter; label: string; test: (j: WorkRow) => boolean }[] = [
  { key: 'new', label: 'New', test: (j) => stageOf(j) === 'new' },
  { key: 'today', label: 'Today', test: isToday },
  { key: 'late', label: 'Late', test: isLate },
  { key: 'waiting', label: 'Waiting', test: (j) => stageOf(j) === 'waiting' },
  { key: 'all', label: 'All', test: (j) => stageOf(j) !== 'done' },
];

export const toneOf = (status: string, kind: WorkRow['kind']): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' => {
  // An installation on an older server sends its challan word; newer ones a complaint's status.
  if (kind === 'installation' && ['pending', 'rejected', 'work_done', 'approved'].includes(status)) return status === 'pending' ? 'brand' : 'success';
  if (['assigned', 'received'].includes(status)) return 'warning';
  if (['on_the_way', 'on_site', 'in_progress'].includes(status)) return 'success';
  if (['awaiting_estimate', 'awaiting_customer', 'resolved', 'closed', 'cancelled'].includes(status)) return 'neutral';
  return 'brand';
};
export const iconOf = (status: string, kind: WorkRow['kind']): IconName => {
  if (kind === 'installation') return 'box';
  if (status === 'assigned' || status === 'received') return 'bell';
  if (status === 'scheduled' || status === 'accepted') return 'calendar';
  if (status === 'on_the_way') return 'navigation';
  if (status === 'on_site' || status === 'in_progress') return 'wrench';
  if (['resolved', 'closed'].includes(status)) return 'check';
  return 'clock';
};

const byTime = (a: WorkRow, b: WorkRow) => (a.nextVisitAt ?? '9999').localeCompare(b.nextVisitAt ?? '9999') || b.givenAt.localeCompare(a.givenAt);

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

  const [filter, setFilter] = useState<Filter>('today');
  const [kind, setKind] = useState<Kind>('all');
  const load = useCallback(() => myJobs(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 15_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ---- search: asked of the server, so finished jobs and old numbers are found too
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState(false);
  const [found, setFound] = useState<{ q: string; branch: boolean; jobs: WorkRow[]; canBranch: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const live = q.trim().length >= 2;
  const seq = useRef(0);
  useEffect(() => {
    // Nothing typed: the old answer is simply not drawn (`live` gates it).
    if (!live) return;
    const n = ++seq.current;
    const h = setTimeout(async () => {
      setSearching(true); setSearchError(null);
      try {
        const r = await searchJobs(q.trim(), branch);
        if (!r) throw new Error(t('Search needs a connection.'));
        if (n === seq.current) setFound({ q: q.trim(), branch: r.branch, jobs: r.jobs, canBranch: r.canBranch });
      } catch (e) {
        if (n === seq.current) setSearchError(e instanceof Error ? e.message : t('Could not search.'));
      } finally {
        if (n === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [q, branch, live, t]);

  const typesOn = L.types.complaints && L.types.installations;
  const typed = useMemo(() => (data?.jobs ?? [])
    .filter((j) => (j.kind === 'complaint' ? L.types.complaints : L.types.installations))
    .filter((j) => kind === 'all' || j.kind === kind), [data, L.types, kind]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, typed.filter(f.test).length])) as Record<Filter, number>, [typed]);
  const lateCount = counts.late;

  const sections = useMemo(() => {
    if (live) {
      const jobs = (found?.jobs ?? []).filter((j) => kind === 'all' || j.kind === kind);
      return jobs.length ? [{ title: '', data: jobs }] : [];
    }
    const rows = typed.filter(FILTERS.find((f) => f.key === filter)!.test);
    const group = (title: string, d: WorkRow[]) => ({ title, data: [...d].sort(byTime) });
    if (filter === 'today') {
      return [group('On site now', rows.filter((j) => j.onSite)), group('Today, by time', rows.filter((j) => !j.onSite))].filter((s) => s.data.length);
    }
    if (filter === 'all') {
      return [
        group('On site now', rows.filter((j) => j.onSite)),
        group('Late', rows.filter((j) => isLate(j) && !j.onSite)),
        group('New - accept them', rows.filter((j) => stageOf(j) === 'new' && !isLate(j))),
        group('Booked', rows.filter((j) => stageOf(j) === 'working' && !j.onSite && !isLate(j))),
        group('Waiting on others - nothing for you to do', rows.filter((j) => stageOf(j) === 'waiting')),
      ].filter((s) => s.data.length);
    }
    return rows.length ? [group('', rows)] : [];
  }, [live, found, typed, filter, kind]);

  const open = (j: WorkRow) => (j.kind === 'complaint'
    ? router.push({ pathname: '/employee/complaint/[id]', params: { id: j.id } })
    : router.push({ pathname: '/employee/installation/[id]', params: { id: j.id } }));

  const accept = async (j: WorkRow) => {
    setBusy(j.id); setNotice(null);
    try {
      await complaintAction(j.id, { op: 'accept' });
      setNotice({ tone: 'success', text: t('Accepted - the customer can see you are assigned.') });
      await reload();
    } catch (e) {
      setNotice({ tone: 'danger', text: e instanceof Error ? e.message : t('Could not accept it.') });
    } finally {
      setBusy(null);
    }
  };

  const emptyLine = live
    ? (searching ? '' : found ? `${t('Nothing matches')} "${found.q}".` : '')
    : ({ new: t('Nothing new.'), today: t('No visits booked for today.'), late: t('Nothing late.'), waiting: t('Nothing waiting on others.'), all: t('No open jobs.') } as Record<Filter, string>)[filter];

  return (
    <Screen edges={['top']}>
      {/* ---- header: title, search, filters - fixed; the list scrolls under it */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('My work')}</Text>
          {lateCount > 0 && (
            <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.dangerSoft }}>
              <Text variant="small" weight="bold" color={c.danger}>{`${lateCount} ${t('late')}`}</Text>
            </View>
          )}
          <PrefSwitches />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: live ? c.brand : c.line, backgroundColor: c.bg, paddingHorizontal: space.md }}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('Complaint no, customer, phone, serial')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('Search jobs')}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={{ flex: 1, minWidth: 0, fontSize: 16, color: c.ink, paddingVertical: space.sm }}
          />
          {q ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Clear search')} hitSlop={10} onPress={() => { setQ(''); setBranch(false); }}>
              <Icon name="x" size={18} color={c.muted} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t('Scan a serial')} hitSlop={10} onPress={() => setScanning(true)}>
            <Icon name="scan" size={20} color={c.brand} />
          </Pressable>
        </View>

        {live ? (
          // While searching the filters step aside; where to look takes their place.
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {([['mine', t('My jobs')], ['branch', t('Whole branch')]] as const)
              .filter(([k]) => k === 'mine' || found?.canBranch)
              .map(([k, label]) => {
                const on = (k === 'branch') === branch;
                return (
                  <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setBranch(k === 'branch')}
                    style={{ flex: 1, minHeight: 40, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Text variant="small" weight="bold" color={on ? c.brand : c.ink}>{label}</Text>
                  </Pressable>
                );
              })}
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingEnd: space.sm }}>
            {FILTERS.map((f) => {
              const on = f.key === filter;
              const n = counts[f.key];
              const red = f.key === 'late' && n > 0;
              const fg = on ? c.brandInk : red ? c.danger : c.ink;
              return (
                <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setFilter(f.key)}
                  style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5,
                    borderColor: on ? (red ? c.danger : c.brand) : c.line, backgroundColor: on ? (red ? c.danger : c.brand) : c.surface }}>
                  <Text weight="bold" color={fg}>{t(f.label)}</Text>
                  {data && (
                    <View style={{ minWidth: 22, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: on ? 'rgba(255,255,255,0.25)' : red ? c.dangerSoft : c.surface2, alignItems: 'center' }}>
                      <Text variant="small" weight="bold" color={fg}>{String(n)}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {typesOn && (
          <View style={{ flexDirection: 'row' }}>
            {([['all', t('All kinds')], ['complaint', t('Complaints')], ['installation', t('Installations')]] as const).map(([k, label]) => {
              const on = k === kind;
              return (
                <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setKind(k)}
                  style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: on ? c.brand : 'transparent' }}>
                  <Text variant="small" weight="bold" color={on ? c.ink : c.muted}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(j) => `${j.kind}-${j.id}`}
        stickySectionHeadersEnabled={false}
        persistentScrollbar
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={7}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} colors={[c.brand]} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
        ListHeaderComponent={(
          <View style={{ gap: space.sm }}>
            <OfflineBar />
            <UpdateBanner />
            {error && <Banner tone="danger">{error}</Banner>}
            {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
            {live && searchError && <Banner tone="danger">{searchError}</Banner>}
            {live && found && !searching && (
              <Text variant="small" weight="semibold" color={c.muted}>
                {`${found.jobs.length} ${t('found')} · ${found.branch ? t('whole branch') : t('my jobs')} · ${t('open and finished')}`}
              </Text>
            )}
            {live && searching && <Loading />}
          </View>
        )}
        renderSectionHeader={({ section }) => (section.title ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
            <Text variant="micro" weight="bold" color={c.muted}>{t(section.title).toUpperCase()}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          </View>
        ) : null)}
        renderItem={({ item }) => (
          <JobCard j={item} busy={busy === item.id} onOpen={() => open(item)} onAccept={() => void accept(item)} />
        )}
        ListEmptyComponent={loading && !data ? <Loading /> : emptyLine ? (
          <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.md }}>
            <Icon name={live ? 'search' : 'check'} size={32} color={c.muted} />
            <Text color={c.inkSoft} style={{ textAlign: 'center' }}>{emptyLine}</Text>
            {live && found && !found.branch && found.canBranch && (
              <Pressable accessibilityRole="button" onPress={() => setBranch(true)}
                style={{ minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text weight="bold" color={c.brand}>{t('Search the whole branch')}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      />
      {scanning && (
        <Scanner visible mode="code" title={t('Scan a serial')} prompt={t('Point the camera at the number on the box.')}
          onClose={() => setScanning(false)} onCode={(code: string) => { setScanning(false); setQ(code); }} />
      )}
      <SimpleNav current="work" schedule={L.schedule} />
    </Screen>
  );
}

function JobCard({ j, busy, onOpen, onAccept }: { j: WorkRow; busy: boolean; onOpen: () => void; onAccept: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const stage = stageOf(j);
  const late = isLate(j);
  const dim = stage === 'waiting' || stage === 'done' || j.mine === false;
  const tone = toneOf(j.status, j.kind);
  const col = late ? c.danger : { brand: c.brand, success: c.success, warning: c.warning, danger: c.danger, neutral: c.inkSoft }[tone];
  const soft = late ? c.dangerSoft : { brand: c.brandSoft, success: c.successSoft, warning: c.warningSoft, danger: c.dangerSoft, neutral: c.surface2 }[tone];
  const when = j.nextVisitAt ? new Date(j.nextVisitAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  const phone = dialable(j.customerPhone, j.customerPhoneDial);
  const nav = j.lat != null && j.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${j.lat},${j.lng}`
    : j.siteLocationNavigate || j.siteLocation ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.siteLocationNavigate || j.siteLocation || '')}` : null;
  const mine = j.mine !== false;
  const working = stage === 'working';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${j.customerName}, ${t(j.statusLabel)}`} onPress={onOpen}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: late ? 2 : 1, borderColor: late ? c.danger : c.line, backgroundColor: pressed ? c.brandSoft : c.surface, padding: space.lg, gap: space.sm, opacity: dim ? 0.85 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={late ? 'alert' : iconOf(j.status, j.kind)} size={20} color={col} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="bold" numberOfLines={1}>{j.customerName}</Text>
          <Text variant="small" weight="semibold" color={col} numberOfLines={1}>{t(j.statusLabel)}</Text>
        </View>
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: j.kind === 'installation' ? c.accentSoft : c.surface2 }}>
          <Text variant="micro" weight="semibold" color={j.kind === 'installation' ? c.accent : c.inkSoft}>{t(j.kind === 'installation' ? 'Installation' : 'Complaint')}</Text>
        </View>
      </View>
      {j.problem ? <Text numberOfLines={2}>{j.problem}</Text> : null}
      {j.siteLocation ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="mapPin" size={14} color={c.muted} />
          <Text variant="small" color={c.inkSoft} numberOfLines={1} style={{ flex: 1 }}>{j.siteLocation}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        {when && <Text variant="small" weight="semibold" color={late ? c.danger : c.ink}>{`${t('Visit')}: ${when}`}</Text>}
        <Text variant="micro" color={c.muted} style={{ marginStart: 'auto' }}>{j.no}</Text>
      </View>
      {late && j.lateReason && <Text variant="small" weight="bold" color={c.danger}>{`${t('Late')} - ${t(j.lateReason)}`}</Text>}
      {!mine && <Text variant="small" color={c.muted}>{t('Not your job - opens read-only')}</Text>}

      {/* One next step on the card; everything else is inside the job. */}
      {mine && stage !== 'done' && (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 2 }}>
          {stage === 'new' && j.kind === 'complaint' ? (
            <CardButton main icon="check" label={busy ? t('Accepting…') : t('Accept')} onPress={onAccept} disabled={busy} />
          ) : (
            <CardButton main={working} icon="arrowRight" label={j.onSite ? t('Continue job') : t('Open job')} onPress={onOpen} />
          )}
          {working && nav && <CardButton icon="navigation" label={t('Navigate')} onPress={() => void Linking.openURL(nav)} />}
          {phone ? <CardButton icon="phone" label={t('Call')} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
        </View>
      )}
    </Pressable>
  );
}

function CardButton({ icon, label, onPress, main = false, disabled = false }: { icon: IconName; label: string; onPress: () => void; main?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm,
        borderRadius: radius.md, borderWidth: 1.5, borderColor: main ? c.brand : c.line,
        backgroundColor: main ? (pressed ? c.brandSoft : c.brand) : pressed ? c.surface2 : c.surface, opacity: disabled ? 0.6 : 1 })}>
      <Icon name={icon} size={16} color={main ? c.brandInk : c.ink} />
      <Text variant="small" weight="bold" color={main ? c.brandInk : c.ink} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
