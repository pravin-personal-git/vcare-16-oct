import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { invoices, invoiceTone, type InvoiceRow } from '@/lib/sales';
import { useOutboxCounts, waiting, type OutboxItem } from '@/lib/outbox';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * INVOICES on the phone (13 Oct 2026, native admin app part 3): the website's
 * list (same reach rule), Unpaid / Overdue / Draft / Paid chips, search, New.
 * Invoices made with no signal show on top until they reach the office.
 */
type Chip = 'all' | 'unpaid' | 'overdue' | 'draft' | 'paid';

const due = (r: InvoiceRow) => Math.max(0, r.grandTotalPaise - r.amountPaidPaise);
export default function Invoices() {
  const { t } = useT();
  const { c } = useTheme();
  const [view, setView] = useState<'active' | 'history'>('active');
  const load = useCallback(() => invoices(view), [view]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => { if (seen) void reload(); else setSeen(true); }, [seen, reload]));
  const [chip, setChip] = useState<Chip>('all');
  const [q, setQ] = useState('');
  const counts = useOutboxCounts();
  const [pending, setPending] = useState<OutboxItem[]>([]);
  useEffect(() => { void waiting('invoice:new').then(setPending); }, [counts.waiting]);
  const [now] = useState(() => new Date().getTime());

  const match = (r: InvoiceRow, k: Chip) => {
    const s = invoiceTone(r, now).label;
    return k === 'all' || (k === 'unpaid' ? (s === 'Unpaid' || s === 'Part paid' || s === 'Overdue') : k === 'overdue' ? s === 'Overdue' : k === 'draft' ? s === 'Draft' : s === 'Paid');
  };
  const all = data?.invoices ?? [];
  const rows = all.filter((r) => match(r, chip)
    && (!q.trim() || `${r.invoiceNo} ${r.customerName} ${r.organizationName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const owed = all.filter((r) => r.lifecycle === 'sent').reduce((n, r) => n + due(r), 0);

  return (
    <SubScreen title={t('Invoices')} subtitle={data ? `${rupees(owed)} ${t('to collect')}` : undefined} onRefresh={reload}
      right={data?.canCreate ? <Button label={t('New')} icon="plus" onPress={() => router.push('/sales/invoice-new')} /> : undefined}
      list={{ data: rows, key: (r) => r.id, render: (r) => {
          const s = invoiceTone(r, now);
          return (
            <Row key={r.id} title={r.organizationName || r.customerName}
              line={`${r.invoiceNo} · ${rupees(r.grandTotalPaise)}${due(r) && r.lifecycle === 'sent' ? ` · ${rupees(due(r))} ${t('due')}` : ''}`}
              meta={`${fmtDate(r.invoiceDate)}${r.salespersonName ? ` · ${r.salespersonName}` : ''}`}
              onPress={() => router.push({ pathname: '/sales/invoice/[id]', params: { id: r.id } })}
              right={<Pill label={t(s.label)} tone={s.tone} />} />
          );
        } }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['active', 'history'] as const).map((v) => (
          <Pressable key={v} onPress={() => { setView(v); setChip('all'); }} style={{ flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: view === v ? c.brand : c.surface, borderWidth: 1, borderColor: view === v ? c.brand : c.line }}>
            <Text weight="semibold" color={view === v ? c.brandInk : c.ink}>{v === 'active' ? t('Open') : t('History')}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search number, customer')} placeholderTextColor={c.muted}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 12 }]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {(['all', 'unpaid', 'overdue', 'draft', 'paid'] as Chip[]).map((k) => {
          const on = chip === k;
          const label = { all: 'All', unpaid: 'Unpaid', overdue: 'Overdue', draft: 'Draft', paid: 'Paid' }[k];
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => setChip(k)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${t(label)} ${data ? all.filter((r) => match(r, k)).length : ''}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error && <Banner tone="danger">{error}</Banner>}
      {pending.map((p) => (
        <Row key={p.opId} icon="clock" title={String(p.body.customerName ?? '')}
          line={`${p.body.invoiceNo ? String(p.body.invoiceNo) : t('Number from the office')} · ${t('waiting to send')}`} meta={fmtDate(p.at)} />
      ))}
      {loading && !data ? <Loading /> : rows.length === 0 && pending.length === 0
        ? <Empty icon="file" title={t('No invoices')} />
        : null}
    </SubScreen>
  );
}
