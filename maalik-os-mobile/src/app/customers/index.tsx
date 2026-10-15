import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Text } from '@/components/ui';
import { Empty, Loading, Row, SubScreen, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { customers } from '@/lib/customers';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * CUSTOMERS on the phone (13 Oct 2026, native admin app part 4): search by
 * name, company, phone, code or city; "Owes us" and "Over credit limit"
 * chips; tap for the customer page. Works offline from the last copy.
 */
type Chip = 'all' | 'owes' | 'over';

export default function Customers() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => customers(), []);
  const { data, error, loading, reload } = useLoad(load);
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const needle = q.trim().toLowerCase();
  const all = data?.customers ?? [];
  const is = (r: (typeof all)[number], k: Chip) => k === 'all' || (k === 'owes' ? r.balancePaise > 0 : r.creditLimitPaise > 0 && r.balancePaise > r.creditLimitPaise);
  const rows = all.filter((r) => is(r, chip) && (!needle || `${r.name} ${r.company ?? ''} ${r.phone} ${r.code} ${r.city ?? ''}`.toLowerCase().includes(needle))).slice(0, 200);

  return (
    <SubScreen title={t('Customers')} subtitle={data ? `${all.length} · ${rupees(data.totalOwedPaise)} ${t('to collect')}` : undefined} onRefresh={reload}
      list={{ data: rows, key: (r) => r.id, render: (r) => (
          <Row key={r.id} title={r.company ? `${r.name} · ${r.company}` : r.name}
            line={[r.phone.trim(), r.city].filter(Boolean).join(' · ') || r.code}
            meta={r.code}
            onPress={() => router.push({ pathname: '/customers/[id]', params: { id: r.id } })}
            right={r.balancePaise > 0 ? <Text weight="bold" color={r.creditLimitPaise > 0 && r.balancePaise > r.creditLimitPaise ? c.danger : c.warning}>{rupees(r.balancePaise)}</Text> : undefined} />
        ) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search name, company, phone, city')} placeholderTextColor={c.muted}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {([['all', 'All'], ['owes', 'Owes us'], ['over', 'Over credit limit']] as [Chip, string][]).map(([k, label]) => {
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
        ? <Empty icon="user" title={t('No customers')} />
        : null}
      {rows.length === 200 && <Text variant="small" color={c.muted} align="center">{t('Showing the first 200 - search to narrow.')}</Text>}
    </SubScreen>
  );
}
