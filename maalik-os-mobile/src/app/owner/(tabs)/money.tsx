import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, PrefSwitches, Screen, Text } from '@/components/ui';
import { Loading, Row, Segmented, fmtDate, rupees, useLoad } from '@/components/Kit';
import { OfflineBar } from '@/components/OfflineBar';
import { MenuList } from '@/components/MenuList';
import { ownerSummary } from '@/lib/owner';
import { moneyPage } from '@/lib/people';
import { radius, space } from '@/theme/tokens';

/**
 * MONEY tab, native (13 Oct 2026, ADMIN-NATIVE-APP-SPEC part 5): today at a
 * glance (owner summary - the Accounts dashboard's rules), then the lists
 * behind it - money received, expenses this month, what we owe suppliers -
 * from the website's own Receipts, Transactions and Payables. Who owes us
 * opens the customers list. P&L and GST stay on the website.
 */
type Tab = 'in' | 'out' | 'owe';

export default function MoneyTab() {
  const { t } = useT();
  const { c } = useTheme();
  const loadSummary = useCallback(() => ownerSummary(), []);
  const { data, error, loading, reload } = useLoad(loadSummary, { everyMs: 60_000 });
  const loadMoney = useCallback(() => moneyPage(), []);
  const money = useLoad(loadMoney, { everyMs: 120_000 });
  const m = money.data;
  const [tab, setTab] = useState<Tab>('in');
  const [refreshing, setRefreshing] = useState(false);
  const fig = (label: string, value: string, tone?: string, line?: string) => (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
      <Text variant="micro" color={c.inkSoft}>{label}</Text>
      <Text variant="h3" weight="bold" color={tone ?? c.ink}>{value}</Text>
      {line ? <Text variant="micro" color={c.muted}>{line}</Text> : null}
    </View>
  );
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('Money')}</Text>
        <PrefSwitches />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} colors={[c.brand]} onRefresh={async () => { setRefreshing(true); try { await Promise.all([reload(), money.reload()]); } finally { setRefreshing(false); } }} />}>
        <OfflineBar />
        {(error || money.error) && <Banner tone="danger">{error ?? money.error}</Banner>}
        {loading && !data ? <Loading /> : data && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {fig(t('Sales today'), rupees(data.salesPaise))}
            {fig(t('Collected today'), rupees(data.collectedPaise), c.success)}
            {fig(t('To collect'), rupees(data.toCollectPaise), undefined, data.overduePaise > 0 ? `${rupees(data.overduePaise)} ${t('overdue')}` : undefined)}
            {m ? fig(t('We owe suppliers'), rupees(m.payables.totalPaise), m.payables.totalPaise > 0 ? c.warning : undefined) : null}
            {m ? fig(t('Received this month'), rupees(m.receiptsMonth.totalPaise), undefined, `${m.receiptsMonth.count} ${t('receipts')}`) : null}
            {m ? fig(t('Spent this month'), rupees(m.expenseMonth.totalPaise), undefined, m.expenseMonth.pending ? `${m.expenseMonth.pending} ${t('waiting for approval')}` : undefined) : null}
          </View>
        )}
        {m && (
          <>
            <Segmented value={tab} onChange={setTab} options={[
              { key: 'in', label: t('Received') }, { key: 'out', label: t('Expenses') }, { key: 'owe', label: t('We owe') },
            ]} />
            {tab === 'in' && (m.recentReceipts.length === 0 ? <Text color={c.muted}>{t('Nothing received this month yet.')}</Text>
              : m.recentReceipts.map((r) => (
                <Row key={r.id} title={r.partyName} line={`${r.receiptNo} · ${t(r.method.toUpperCase() === 'UPI' ? 'UPI' : r.method)}`} meta={fmtDate(r.receivedAt)}
                  right={<Text weight="bold" color={c.success}>{rupees(r.amountPaise)}</Text>} />
              )))}
            {tab === 'out' && (m.recentExpenses.length === 0 ? <Text color={c.muted}>{t('No expenses this month.')}</Text>
              : m.recentExpenses.map((x) => (
                <Row key={x.id} title={x.description || x.txnNo} line={`${x.txnNo}${x.method ? ` · ${x.method}` : ''}${x.status !== 'approved' ? ` · ${t(x.status)}` : ''}`} meta={fmtDate(x.date)}
                  right={<Text weight="bold">{rupees(x.amountPaise)}</Text>} />
              )))}
            {tab === 'owe' && (m.payables.suppliers.length === 0 ? <Text color={c.muted}>{t('We owe nobody.')}</Text>
              : m.payables.suppliers.map((s) => (
                <Row key={s.partyId} title={s.name} line={`${s.bills} ${t('bills')}`} meta={s.oldestDueDate ? `${t('oldest due')} ${fmtDate(s.oldestDueDate)}` : undefined}
                  right={<Text weight="bold" color={c.warning}>{rupees(s.owedPaise)}</Text>} />
              )))}
          </>
        )}
        <MenuList items={[
          { icon: 'user', label: t('Who owes us'), line: t('Customers with money due'), href: '/customers' },
          { icon: 'file', label: t('Invoices'), href: '/sales/invoices' },
          { icon: 'send', label: t('Record a receipt'), line: t('Payments not against one invoice'), web: '/receipts?pay=1' },
          { icon: 'trending', label: t('Profit and loss'), web: '/reports/profit-loss' },
          { icon: 'file', label: t('GST'), web: '/reports/gst' },
        ]} />
      </ScrollView>
    </Screen>
  );
}
