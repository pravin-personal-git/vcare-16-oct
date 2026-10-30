import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, Segmented, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { myComplaints, STATUS_LABEL, statusTone, type ComplaintRow } from '@/lib/jobs';
import { radius, space } from '@/theme/tokens';
import { useAccess } from '@/lib/access';
import { TopTabs } from '@/components/TopTabs';
import { DateFilter, inDateRange, type DateKey } from '@/components/DateFilter';

type Tab = 'todo' | 'visits' | 'done';
type Kind = 'all' | 'complaint' | 'installation' | 'repair';

/**
 * The technician's jobs (Pravin, 28 Sep 2026): To do · Upcoming visits · Done,
 * filtered by kind - complaints, installations, repairs. Refreshes itself
 * every few seconds while open, and when you come back from a job.
 */
export default function Jobs() {
  const { t } = useT();
  const { c } = useTheme();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [tab, setTab] = useState<Tab>('todo');
  const [kind, setKind] = useState<Kind>('all');
  // "Whole branch" only when the owner allows it (Settings > Roles > Phone app).
  const access = useAccess();
  const load = useCallback(() => myComplaints(scope === 'all'), [scope]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  // Back from a job: show where each job is now, not where it was (emulator run, 28 Sep 2026).
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => {
    if (seen) void reload();
    else setSeen(true);
  }, [seen, reload]));

  /*
    ONE DATE FILTER FOR THREE LISTS (8 Oct 2026).

    Each list is judged on the date that means something for it: a job on
    when it was RAISED, a visit on when it is BOOKED FOR. A single "this
    week" over both would otherwise quietly mean two different things on one
    screen.
  */
  const [when, setWhen] = useState<DateKey>('all');
  const ofKind = (r: ComplaintRow) => kind === 'all' || (r.jobType ?? 'complaint') === kind;
  const inWindow = (r: ComplaintRow) => inDateRange(r.createdAt, when);
  const todo = (data?.complaints ?? []).filter((r) => ofKind(r) && inWindow(r));
  const done = (data?.done ?? []).filter((r) => ofKind(r) && inWindow(r));
  const byJob = new Map((data?.complaints ?? []).map((r) => [r.id, r]));
  const visits = (data?.visits ?? [])
    .filter((v) => (kind === 'all' || (byJob.get(v.complaintId)?.jobType ?? 'complaint') === kind)
      && inDateRange(v.scheduledAt, when))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const open = (id: string) => router.push({ pathname: '/employee/complaint/[id]', params: { id } });
  const KINDS: { key: Kind; label: string }[] = [
    { key: 'all', label: t('All') }, { key: 'complaint', label: t('Complaints') },
    { key: 'installation', label: t('Installations') }, { key: 'repair', label: t('Repairs') },
  ];
  const jobRow = (cm: ComplaintRow) => (
    <Row
      key={cm.id}
      title={cm.customerName}
      line={cm.description}
      meta={`${cm.complaintNo}${cm.jobType && cm.jobType !== 'complaint' ? ` · ${t(cm.jobType === 'installation' ? 'Installation' : 'Repair')}` : ''}${cm.productName ? ` · ${cm.productName}` : ''}`}
      onPress={() => open(cm.id)}
      right={
        <View style={{ alignItems: 'flex-end', gap: space.xs }}>
          <Pill label={t(STATUS_LABEL[cm.status] ?? cm.status)} tone={statusTone(cm.status)} />
          {cm.priority === 'high' || cm.priority === 'urgent' ? <Pill label={t('Urgent')} tone="danger" /> : null}
        </View>
      }
    />
  );

  return (
    <SubScreen title={t('Jobs')} subtitle={t('Your service jobs and site visits')} onRefresh={reload}>
      <TopTabs current="jobs" />
      {access.scope.complaints === 'branch' && <Segmented value={scope} onChange={setScope} options={[{ key: 'mine', label: t('Mine') }, { key: 'all', label: t('Whole branch') }]} />}
      <DateFilter value={when} onChange={setWhen} />
      <Segmented value={tab} onChange={setTab} options={[
        { key: 'todo', label: `${t('To do')}${data ? ` (${todo.length})` : ''}` },
        { key: 'visits', label: `${t('Visits')}${data ? ` (${visits.length})` : ''}` },
        { key: 'done', label: t('Done') },
      ]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {KINDS.map((k) => (
          <Pressable key={k.key} accessibilityRole="button" accessibilityState={{ selected: kind === k.key }} onPress={() => setKind(k.key)}
            style={{ paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: kind === k.key ? c.brand : c.line, backgroundColor: kind === k.key ? c.brandSoft : 'transparent' }}>
            <Text variant="small" weight={kind === k.key ? 'semibold' : undefined} color={kind === k.key ? c.brand : c.inkSoft}>{k.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && (
        <>
          {tab === 'todo' && (todo.length === 0
            ? <Empty icon="wrench" title={t('Nothing to do')} line={scope === 'mine' ? t('Jobs assigned to you appear here.') : undefined} />
            : todo.map(jobRow))}
          {tab === 'visits' && (visits.length === 0
            ? <Empty icon="mapPin" title={t('No visits booked')} line={t('Book a visit from a job.')} />
            : visits.map((v) => (
              <Row
                key={v.id}
                icon="mapPin"
                title={v.customerName}
                // 13 Oct 2026: an installation's visit has no complaint - it read "undefined" and opened nothing.
                line={`${v.complaintNo ?? v.docNo ?? ''} · ${t(v.subject === 'installation' ? 'Installation' : v.purpose === 'field_visit' ? 'Field visit' : 'Visit')}`}
                meta={`${fmtDateTime(v.scheduledAt)}${v.checkedInAt ? ` · ${t('Checked in')}` : ''}`}
                onPress={() => (v.subject === 'installation' && v.installationChallanId
                  ? router.push({ pathname: '/employee/installation/[id]', params: { id: v.installationChallanId } })
                  : open(v.complaintId))}
              />
            )))}
          {tab === 'done' && (done.length === 0
            ? <Empty icon="check" title={t('Nothing finished in the last 30 days')} />
            : done.map(jobRow))}
          {!data.canEdit && <Banner tone="info">{t('You can view jobs but not update them.')}</Banner>}
        </>
      )}
    </SubScreen>
  );
}
