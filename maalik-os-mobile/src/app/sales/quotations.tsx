import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { quotations, STATUS_LABEL, STATUS_TONE, type QuotationStatus } from '@/lib/sales';
import { useOutboxCounts, waiting, type OutboxItem } from '@/lib/outbox';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * QUOTATIONS on the phone (13 Oct 2026, native admin app - sales part 1).
 * The website's list (same reach rule), status chips, search, New. A
 * quotation made with no signal shows at the top as "waiting to send" until
 * it reaches the office and gets its number.
 */
type Chip = 'all' | QuotationStatus;

export default function Quotations() {
  const { t } = useT();
  const { c } = useTheme();
  const [view, setView] = useState<'active' | 'history'>('active');
  const load = useCallback(() => quotations(view), [view]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [chip, setChip] = useState<Chip>('all');
  const [q, setQ] = useState('');
  const counts = useOutboxCounts();
  const [pending, setPending] = useState<OutboxItem[]>([]);
  useEffect(() => { void waiting('quotation:new').then(setPending); }, [counts.waiting]);

  const rows = (data?.quotations ?? []).filter((r) => (chip === 'all' || r.status === chip)
    && (!q.trim() || `${r.quotationNo} ${r.customerName} ${r.organizationName ?? ''} ${r.phone}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chips: Chip[] = view === 'active' ? ['all', 'draft', 'sent', 'accepted'] : ['all', 'converted', 'rejected', 'expired'];

  return (
    <SubScreen title={t('Quotations')} onRefresh={reload}
      right={data?.canCreate ? <Button label={t('New')} icon="plus" onPress={() => router.push('/sales/quotation-new')} /> : undefined}
      list={{ data: rows, key: (r) => r.id, render: (r) => (
          <Row key={r.id} title={r.organizationName || r.customerName}
            line={`${r.quotationNo} · ${rupees(r.grandTotalPaise)} · ${r.itemCount} ${t('items')}`}
            meta={`${fmtDate(r.quotationDate)}${r.salespersonName ? ` · ${r.salespersonName}` : ''}${r.awaitingApproval ? ` · ${t('Awaiting approval')}` : ''}`}
            onPress={() => router.push({ pathname: '/sales/quotation/[id]', params: { id: r.id } })}
            right={<Pill label={t(STATUS_LABEL[r.status])} tone={STATUS_TONE[r.status]} />} />
        ) }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['active', 'history'] as const).map((v) => (
          <Pressable key={v} onPress={() => { setView(v); setChip('all'); }} style={{ flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: view === v ? c.brand : c.surface, borderWidth: 1, borderColor: view === v ? c.brand : c.line }}>
            <Text weight="semibold" color={view === v ? c.brandInk : c.ink}>{v === 'active' ? t('Open') : t('History')}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search number, customer, phone')} placeholderTextColor={c.muted}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {chips.map((k) => {
          const on = chip === k;
          const n = k === 'all' ? data?.quotations.length : data?.quotations.filter((r) => r.status === k).length;
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => setChip(k)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${k === 'all' ? t('All') : t(STATUS_LABEL[k])}${n !== undefined ? ` ${n}` : ''}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error && <Banner tone="danger">{error}</Banner>}
      {pending.map((p) => (
        <Row key={p.opId} icon="clock" title={String(p.body.customerName ?? '')} line={t('Waiting to send - gets its number when it reaches the office')} meta={fmtDate(p.at)} />
      ))}
      {loading && !data ? <Loading /> : rows.length === 0 && pending.length === 0
        ? <Empty icon="file" title={t('No quotations')} />
        : null}
    </SubScreen>
  );
}
