import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Text } from '@/components/ui';
import { Empty, Loading, Row, SubScreen, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { stockOnHand, type StockRow } from '@/lib/customers';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * STOCK ON HAND on the phone (13 Oct 2026, native admin app part 4): the
 * website's Stock on Hand - every product's quantity; chips for Out of stock,
 * Reorder now and Below zero; search by name, code, barcode, category or
 * brand. Value only for people who may see prices. Works offline.
 */
type Chip = 'all' | 'out' | 'reorder' | 'negative';

export default function StockOnHand() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => stockOnHand(), []);
  const { data, error, loading, reload } = useLoad(load);
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const is = (r: StockRow, k: Chip) => k === 'all' || (k === 'out' ? r.qty <= 0 : k === 'reorder' ? r.needsReorder : r.negative);
  const needle = q.trim().toLowerCase();
  const all = data?.rows ?? [];
  const rows = all.filter((r) => is(r, chip) && (!needle || `${r.name} ${r.code} ${r.barcode ?? ''} ${r.category ?? ''} ${r.brand ?? ''}`.toLowerCase().includes(needle))).slice(0, 200);

  return (
    <SubScreen title={t('Stock on hand')} subtitle={data?.totalValuePaise !== undefined ? `${t('Value')} ${rupees(data.totalValuePaise)}` : undefined} onRefresh={reload}
      list={{ data: rows, key: (r) => r.productId, render: (r) => (
          <Row key={r.productId} title={r.name} line={[r.code, r.brand, r.category].filter(Boolean).join(' · ')}
            meta={r.needsReorder ? `${t('Reorder at')} ${r.reorderLevel}` : undefined}
            right={
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="h3" weight="bold" color={r.qty <= 0 ? c.danger : r.needsReorder ? c.warning : c.ink}>{String(r.qty)}</Text>
                <Text variant="micro" color={c.muted}>{r.unit}</Text>
              </View>
            } />
        ) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search product, code, barcode, brand')} placeholderTextColor={c.muted}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {([['all', 'All'], ['out', 'Out of stock'], ['reorder', 'Reorder now'], ['negative', 'Below zero']] as [Chip, string][]).map(([k, label]) => {
          const on = chip === k;
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => setChip(k)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${t(label)} ${data ? all.filter((r) => is(r, k)).length : ''}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : rows.length === 0
        ? <Empty icon="box" title={t('Nothing here')} />
        : null}
      {rows.length === 200 && <Text variant="small" color={c.muted} align="center">{t('Showing the first 200 - search to narrow.')}</Text>}
    </SubScreen>
  );
}
