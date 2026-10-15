import { useCallback } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, SubScreen, useLoad } from '@/components/Kit';
import { TopTabs } from '@/components/TopTabs';
import { myVan } from '@/lib/jobs';
import { space } from '@/theme/tokens';

/**
 * What this technician is carrying.
 *
 * Stock in a van has NOT left the business (Pravin's decision 6) — it is still
 * on hand, it is just not on a shelf anybody at the branch can reach. This is
 * the screen that makes that true for the person holding it: before this, the
 * only honest answer to "what is on your van?" was to open the back doors.
 *
 * Fitting is recorded from the job, not here. A list of stock with a "use"
 * button beside every line invites somebody to tap one on the drive home; the
 * same action inside an installation or a complaint knows which site it went to
 * and puts the customer's name on the unit.
 */
export default function MyVan() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => myVan(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 15000 });

  const van = data?.van ?? null;
  const items = van?.items ?? [];
  const lines = items.length;
  const total = items.reduce((n, i) => n + i.qty, 0);

  return (
    <SubScreen
      title={van ? van.name : t('My van')}
      subtitle={van ? `${lines} ${t('lines')} · ${total} ${t('items')}` : undefined}
      onRefresh={reload}
    >
      <TopTabs current="van" />
      {van && <Button icon="scan" label={t('Load my van')} onPress={() => router.push('/employee/van-load')} />}
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data && <Loading />}

      {data && !van && (
        <Empty
          icon="box"
          title={t('No van is assigned to you')}
          line={t('Ask the branch to set one up and load it. Until then, parts are issued to you per job.')}
        />
      )}

      {van && items.length === 0 && (
        <Empty
          icon="box"
          title={t('Your van is empty')}
          line={t('Nothing is loaded. Tap Load my van at the store and scan what you take, or the branch loads it from Van Stock on the website.')}
        />
      )}

      {items.length > 0 && <SectionLabel>{t('On board')}</SectionLabel>}
      {items.map((i) => (
        <Card key={i.productId}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{i.productName}</Text>
              <Text variant="micro" color={c.muted}>
                {[i.productCode, i.trackingMode === 'serial' ? t('tracked by number') : null]
                  .filter(Boolean).join(' · ')}
              </Text>
              {/*
                The individual numbers, where the product is tracked that way.
                Capped — a van carrying forty cameras is a list nobody reads, and
                the count above is the answer to the question being asked.
              */}
              {i.units.length > 0 && (
                <Text variant="micro" color={c.inkSoft} style={{ marginTop: 2 }}>
                  {i.units.slice(0, 6).map((u) => u.serialNo ?? '—').join(' · ')}
                  {i.units.length > 6 ? ` ${t('and')} ${i.units.length - 6} ${t('more')}` : ''}
                </Text>
              )}
            </View>
            <Pill label={`${i.qty}${i.unit ? ` ${i.unit}` : ''}`} tone="brand" />
          </View>
        </Card>
      ))}

      {items.length > 0 && (
        <Banner tone="info">
          {t('This stock is still the company\'s. Record what you fit from inside the job, so it comes off your van and goes onto the customer.')}
        </Banner>
      )}
    </SubScreen>
  );
}
