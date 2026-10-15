import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Empty, Loading, Pill, SubScreen, fmtDateTime, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { pickUpShopRequest, shopRequests, type ShopRequest } from '@/lib/shopRequests';
import { radius, space } from '@/theme/tokens';

/**
 * SHOP REQUESTS on the phone (13 Oct 2026, Pravin: "no one ever knows what
 * the customer requested"): what customers sent from the online shop - to
 * buy (a lead) or for a visit (a job) - who has it, and "I'll take it" on a
 * buy request. A visit opens its job, where it is assigned like any other.
 */
type Chip = 'new' | 'buy' | 'visit' | 'all';

export default function ShopRequests() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => shopRequests(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [chip, setChip] = useState<Chip>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const all = data?.requests ?? [];
  const is = (r: ShopRequest, k: Chip) => k === 'all' || (k === 'new' ? r.state === 'new' : r.kind === k);
  const rows = all.filter((r) => is(r, chip));

  const take = async (r: ShopRequest) => {
    setBusy(r.id); setMsg(null);
    try {
      const res = await pickUpShopRequest(r.id);
      if (isQueued(res)) setMsg({ tone: 'warning', text: t(res.message) });
      else if (res) setMsg({ tone: 'success', text: t(res.message) });
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally { setBusy(null); }
  };

  return (
    <SubScreen title={t('Shop requests')} subtitle={t('What customers asked for in the online shop')} onRefresh={reload}
      list={{ data: rows, key: (r) => r.id, render: (r) => (
          <Card key={r.id} style={{ gap: space.xs, borderColor: r.state === 'new' ? c.brand : c.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name={r.kind === 'buy' ? 'box' : 'wrench'} size={20} color={r.kind === 'buy' ? c.brand : c.warning} />
              <View style={{ flex: 1 }}>
                <Text weight="bold">{r.customer.name}</Text>
                <Text variant="small" color={c.inkSoft}>{`${t(r.kind === 'buy' ? 'Wants to buy' : 'Needs a visit')} · ${fmtDateTime(r.at)}`}</Text>
              </View>
              <Pill label={r.state === 'new' ? t('New') : r.state === 'closed' ? t('Closed') : r.ownerName ? `${t('With')} ${r.ownerName}` : t('Picked up')}
                tone={r.state === 'new' ? 'brand' : r.state === 'closed' ? 'neutral' : 'success'} />
            </View>
            {r.items.map((i, k) => <Text key={k} variant="small">{`${i.qty} × ${i.name}`}</Text>)}
            {r.goodsPaise > 0 && <Text variant="micro" color={c.muted}>{`${t('Goods only')} ${rupees(r.goodsPaise)}`}</Text>}
            {r.message ? <Text variant="small" color={c.inkSoft}>{`"${r.message}"`}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
              {r.customer.phone ? <View style={{ flex: 1 }}><Button label={t('Call')} icon="phone" variant="secondary" onPress={() => void Linking.openURL(`tel:${r.customer.phone!.replace(/[^\d+]/g, '')}`)} /></View> : null}
              {r.kind === 'buy' && r.state === 'new' && data?.canPickUp && (
                <View style={{ flex: 1 }}><Button label={t("I'll take it")} icon="check" loading={busy === r.id} onPress={() => void take(r)} /></View>
              )}
              {r.kind === 'visit' && r.complaint && (
                <View style={{ flex: 1 }}><Button label={r.state === 'new' ? t('Assign') : t('Open job')} icon="wrench" variant="secondary"
                  onPress={() => router.push({ pathname: '/employee/complaint/[id]', params: { id: r.complaint!.id } })} /></View>
              )}
            </View>
          </Card>
        ) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {([['new', 'New'], ['buy', 'Want to buy'], ['visit', 'Need a visit'], ['all', 'All']] as [Chip, string][]).map(([k, label]) => {
          const on = chip === k;
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => setChip(k)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${t(label)} ${data ? all.filter((r) => is(r, k)).length : ''}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : rows.length === 0
        ? <Empty icon="check" title={chip === 'new' ? t('Nothing new') : t('No shop requests yet')} line={t('When a customer sends their list from the shop, it appears here.')} />
        : null}
    </SubScreen>
  );
}
