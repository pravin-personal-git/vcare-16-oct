import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner } from '@/components/ui';
import { Empty, Loading, Pill, Row, Segmented, SubScreen, fmtDate, useLoad } from '@/components/Kit';
import { TopTabs } from '@/components/TopTabs';
import { DateFilter, inDateRange, type DateKey } from '@/components/DateFilter';
import { myInstallations, type InstallationRow } from '@/lib/jobs';
import { useAccess } from '@/lib/access';

/**
 * Fittings, on their own screen (2 Oct 2026).
 *
 * Separate from Complaints because they are different work. A complaint is
 * something that broke and somebody is unhappy; an installation is work that
 * was sold and is going in today. Sharing one list meant reading past four
 * repairs to find the job you were parked outside of.
 */
export default function Installations() {
  const { t } = useT();
  const access = useAccess();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const load = useCallback(() => myInstallations(scope === 'all'), [scope]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 8000 });

  // Back from a job: show where it is now, not where it was.
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => {
    if (seen) void reload(); else setSeen(true);
  }, [seen, reload]));

  // On the dispatch date: when the goods went out is the date on the
  // challan and the one anybody quotes about it.
  const [when, setWhen] = useState<DateKey>('all');
  const rows = (data?.installations ?? []).filter((r) => inDateRange(r.dispatchedAt, when));
  const open = (id: string) => router.push({ pathname: '/employee/installation/[id]', params: { id } });

  const tone = (s: string): 'success' | 'brand' | 'neutral' =>
    s === 'approved' ? 'success' : s === 'work_done' ? 'brand' : 'neutral';
  const label = (s: string) =>
    s === 'work_done' ? t('Work done') : s === 'approved' ? t('Approved') : t('To fit');

  return (
    <SubScreen title={t('Installations')} subtitle={t('Fittings assigned to you')} onRefresh={reload}>
      <TopTabs current="installs" />
      {access.scope.complaints === 'branch' && (
        <Segmented
          value={scope} onChange={setScope}
          options={[{ key: 'mine', label: t('Mine') }, { key: 'all', label: t('Whole branch') }]}
        />
      )}
      <DateFilter value={when} onChange={setWhen} />
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data && <Loading />}
      {data && rows.length === 0 && (
        <Empty
          icon="wrench"
          title={when === 'all' ? t('Nothing to fit') : t('None in this period')}
          line={when === 'all'
            ? t('Installations appear here once the office puts you on a challan.')
            : t('Tap All to see every one.')}
        />
      )}
      {rows.map((r: InstallationRow) => (
        <Row
          key={r.id}
          title={r.customerName}
          line={r.siteAddress ?? t('No site address on the order')}
          meta={`${r.challanNo}${r.orderNo ? ` · ${r.orderNo}` : ''} · ${fmtDate(r.dispatchedAt)} · ${r.totalQty} ${t('items')}`}
          onPress={() => open(r.id)}
          right={
            r.unscanned > 0
              // The number that matters on this list: items that still have to
              // be scanned as they go in. A job showing 0 is a job that can be
              // handed over.
              ? <Pill label={`${r.unscanned} ${t('to scan')}`} tone="warning" />
              : r.stageLabel && r.status === 'pending'
                // The working stage while it is still open (servers from 11 Oct 2026).
                ? <Pill label={t(r.stageLabel)} tone="brand" />
                : <Pill label={label(r.status)} tone={tone(r.status)} />
          }
        />
      ))}
    </SubScreen>
  );
}
