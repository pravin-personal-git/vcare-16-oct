import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { TopTabs } from '@/components/TopTabs';
import { myComplaints, type VisitRow } from '@/lib/jobs';
import { DateFilter, inDateRange, type DateKey } from '@/components/DateFilter';

/**
 * Site visits, on their own screen.
 *
 * They were a tab inside Jobs, which is where you look if you already know you
 * are looking for a visit. The question a technician actually opens the phone
 * with in the morning is "where am I going and when", and that deserves a tab
 * of its own rather than two taps inside something else.
 */
export default function Visits() {
  const { t } = useT();
  const load = useCallback(() => myComplaints(false), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 8000 });

  /**
   * The clock, held in state and ticked, rather than read during render.
   *
   * "In 25 min" is a countdown, so it has to change on its own - but reading
   * `Date.now()` while rendering makes the component give a different answer
   * every time React happens to re-run it, which is the bug the purity rule
   * exists to catch. Half a minute is fine: nobody acts differently on 25
   * versus 24.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /*
     Filtered on the APPOINTMENT, not on when it was booked. "This week" on a
     visits screen means the week somebody is going out, which is the only
     reading a technician would expect.
  */
  const [when, setWhen] = useState<DateKey>('all');
  const visits = [...(data?.visits ?? [])]
    .filter((v) => inDateRange(v.scheduledAt, when))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const soon = (v: VisitRow) => {
    const mins = (new Date(v.scheduledAt).getTime() - now) / 60000;
    // Within the hour, and not already past. "In 25 min" is the only number on
    // this screen that changes somebody's next action.
    if (mins < 0 || mins > 60) return null;
    return `${t('in')} ${Math.max(1, Math.round(mins))} ${t('min')}`;
  };

  return (
    <SubScreen title={t('Visits')} subtitle={t('Where you are going, and when')} onRefresh={reload}>
      <TopTabs current="visits" />
      <DateFilter value={when} onChange={setWhen} />
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data && <Loading />}
      {data && visits.length === 0 && (
        <Empty
          icon="calendar"
          title={when === 'all' ? t('No visits booked') : t('None in this period')}
          line={when === 'all'
            ? t('A visit appears here as soon as one is booked against a job you are on.')
            : t('Tap All to see every visit.')}
        />
      )}
      {visits.map((v) => {
        const urgent = soon(v);
        return (
          <Row
            key={v.id}
            title={v.customerName}
            line={fmtDateTime(v.scheduledAt)}
            meta={`${v.complaintNo} · ${v.purpose === 'field_visit' ? t('Site visit') : t('Collecting information')}`}
            onPress={() => router.push({ pathname: '/employee/visit/[id]', params: { id: v.id } })}
            right={
              urgent ? <Pill label={urgent} tone="danger" />
                : v.checkedInAt ? <Pill label={t('On site')} tone="success" />
                  : undefined
            }
          />
        );
      })}
    </SubScreen>
  );
}
