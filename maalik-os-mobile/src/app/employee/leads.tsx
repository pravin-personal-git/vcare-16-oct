import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { Empty, Loading, Pill, Row, SectionLabel, Segmented, SubScreen, fmtDate, useLoad } from '@/components/Kit';
import { myLeads, type LeadRow } from '@/lib/jobs';
import { useAccess } from '@/lib/access';
import { DateFilter, inDateRange, type DateKey } from '@/components/DateFilter';

/** A salesperson's leads - follow-ups that are due first. */
export default function Leads() {
  const { t } = useT();
  const { c } = useTheme();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // "Whole branch" only when the owner allows it (Settings > Roles > Phone app).
  const access = useAccess();
  const load = useCallback(() => myLeads(scope === 'all'), [scope]);
  const { data, error, loading, reload } = useLoad(load);

  /*
    Filtered on the NEXT FOLLOW-UP, not on when the lead came in. A
    salesperson asking for "this week" on a leads screen is asking who they
    have to ring this week. A lead with no follow-up set is kept whatever the
    filter says - it is exactly the one somebody forgot about.
  */
  const [when, setWhen] = useState<DateKey>('all');
  const inWindow = (l: LeadRow) => inDateRange(l.nextActionAt, when);
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const shown = (data?.leads ?? []).filter(inWindow);
  const due = shown.filter((l) => l.nextActionAt && new Date(l.nextActionAt) <= endOfToday);
  const rest = shown.filter((l) => !due.includes(l));

  const row = (l: LeadRow, isDue: boolean) => (
    <Row
      key={l.id}
      title={l.businessName || l.displayName}
      line={l.requirement || l.displayName}
      meta={[l.mobile, l.city, l.stageName].filter(Boolean).join(' · ')}
      onPress={() => router.push({ pathname: '/employee/lead/[id]', params: { id: l.id } })}
      right={l.nextActionAt ? <Pill label={fmtDate(l.nextActionAt)} tone={isDue ? 'danger' : 'neutral'} /> : undefined}
    />
  );

  return (
    <SubScreen
      title={t('Leads')}
      subtitle={t('Follow-ups due first')}
      onRefresh={reload}
      right={data?.canCreate ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={t('New lead')}
          onPress={() => router.push('/employee/lead-new')}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="plus" size={22} color={c.brandInk} />
        </Pressable>
      ) : undefined}
    >
      {access.scope.leads === 'branch' && <Segmented value={scope} onChange={setScope} options={[{ key: 'mine', label: t('Mine') }, { key: 'all', label: t('Whole branch') }]} />}
      <DateFilter value={when} onChange={setWhen} />
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && (
        shown.length === 0 ? (
          <Empty
            icon="trending"
            title={when === 'all' ? t('No open leads') : t('None in this period')}
            line={when === 'all'
              ? t('Add one with the + button, or scan a visiting card.')
              : t('Tap All to see every lead.')}
          />
        ) : (
          <>
            {due.length > 0 && <SectionLabel>{t(`Due today (${due.length})`)}</SectionLabel>}
            {due.map((l) => row(l, true))}
            {rest.length > 0 && <SectionLabel>{t('Other leads')}</SectionLabel>}
            {rest.map((l) => row(l, false))}
          </>
        )
      )}
    </SubScreen>
  );
}
