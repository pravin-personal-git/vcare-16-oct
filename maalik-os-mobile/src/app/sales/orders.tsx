import { useCallback, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { orders } from '@/lib/sales';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * SALES ORDERS on the phone (13 Oct 2026, native admin app part 3): the
 * website's list (same reach rule) with search. New orders come from a
 * quotation (Make it a sales order); an order becomes an invoice from its page.
 */
const STATUS: Record<string, string> = {
  pending_approval: 'Waiting for approval', booked: 'Booked', confirmed: 'Confirmed', dispatched: 'Dispatched',
  delivered: 'Delivered', void: 'Cancelled', failed: 'Failed', refunded: 'Refunded',
};

export default function Orders() {
  const { t } = useT();
  const { c } = useTheme();
  const [view, setView] = useState<'active' | 'history'>('active');
  const load = useCallback(() => orders(view), [view]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [q, setQ] = useState('');
  const rows = (data?.orders ?? []).filter((r) => !q.trim() || `${r.orderNo} ${r.customerName} ${r.organizationName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <SubScreen title={t('Sales orders')} onRefresh={reload}
      list={{ data: rows, key: (r) => r.id, render: (r) => (
          <Row key={r.id} title={r.organizationName || r.customerName}
            line={`${r.orderNo} · ${rupees(r.grandTotalPaise)}${r.isInvoiced ? ` · ${t('Invoiced')}` : ''}`}
            meta={`${fmtDate(r.orderDate)}${r.salespersonName ? ` · ${r.salespersonName}` : ''}`}
            onPress={() => router.push({ pathname: '/sales/order/[id]', params: { id: r.id } })}
            right={<Pill label={t(STATUS[r.fulfilmentStatus] ?? r.fulfilmentStatus)} tone={r.fulfilmentStatus === 'pending_approval' ? 'warning' : r.fulfilmentStatus === 'delivered' ? 'success' : 'brand'} />} />
        ) }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['active', 'history'] as const).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} style={{ flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: view === v ? c.brand : c.surface, borderWidth: 1, borderColor: view === v ? c.brand : c.line }}>
            <Text weight="semibold" color={view === v ? c.brandInk : c.ink}>{v === 'active' ? t('Open') : t('History')}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search number, customer')} placeholderTextColor={c.muted}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
      </View>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : rows.length === 0
        ? <Empty icon="box" title={t('No orders')} line={t('Make one from a quotation.')} />
        : null}
    </SubScreen>
  );
}
