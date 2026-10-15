import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, Pill, Row, Segmented, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { customerPage, type CustomerPage, type Tone } from '@/lib/customers';
import { radius, space } from '@/theme/tokens';

/**
 * ONE CUSTOMER on the phone (13 Oct 2026, native admin app part 4) - the
 * website's customer page: what they owe and how late, call / WhatsApp, and
 * tabs for their documents, jobs and the items they hold (warranty, AMC).
 * A document or job opens its own phone screen; the rest open on the website.
 */
type Tab = 'docs' | 'jobs' | 'items';
const toneOf = (t: Tone): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' => (t === 'info' ? 'brand' : t);
const DOC_LABEL: Record<string, string> = {
  quotation: 'Quotation', order: 'Sales order', invoice: 'Invoice', receipt: 'Receipt', credit: 'Credit note', return: 'Return', challan: 'Challan', amc: 'AMC',
};

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => customerPage(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);
  const [tab, setTab] = useState<Tab>('docs');

  const openDoc = (d: CustomerPage['docs'][number]) => {
    if (d.type === 'invoice') router.push({ pathname: '/sales/invoice/[id]', params: { id: d.id } });
    else if (d.type === 'quotation') router.push({ pathname: '/sales/quotation/[id]', params: { id: d.id } });
    else if (d.type === 'order') router.push({ pathname: '/sales/order/[id]', params: { id: d.id } });
    else router.push({ pathname: '/owner/web', params: { next: `/customers/${String(id)}` } });
  };

  const cu = data?.customer;
  const f = data?.figures;
  return (
    <SubScreen title={cu?.name ?? t('Customer')} subtitle={cu ? [cu.company, cu.code].filter(Boolean).join(' · ') : undefined} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && cu && f && (
        <>
          <Card style={{ gap: space.xs }}>
            {cu.phone ? <Text>{cu.phone}</Text> : null}
            {cu.address ? <Text variant="small" color={c.inkSoft}>{cu.address}</Text> : null}
            {cu.gstin ? <Text variant="small" color={c.inkSoft}>{`GSTIN ${cu.gstin}`}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
              {cu.phoneDial ? <View style={{ flex: 1 }}><Button label={t('Call')} icon="phone" variant="secondary" onPress={() => void Linking.openURL(`tel:${cu.phoneDial}`)} /></View> : null}
              {cu.phoneDial ? <View style={{ flex: 1 }}><Button label="WhatsApp" icon="message" variant="secondary" onPress={() => void Linking.openURL(`https://wa.me/${cu.phoneDial.replace(/^\+/, '')}`)} /></View> : null}
            </View>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Fig label={t('Owes us now')} value={rupees(data.docs.filter((d) => d.type === 'invoice').reduce((n, d) => n + (d.duePaise ?? 0), 0))} />
            <Fig label={t('Overdue')} value={rupees(f.overduePaise)} tone={f.overduePaise > 0 ? c.danger : undefined} line={f.oldestDays ? `${t('oldest')} ${f.oldestDays} ${t('days')}` : undefined} />
            <Fig label={t('Bought in all')} value={rupees(f.lifetimePaise)} line={`${f.invoiceCount} ${t('invoices')}`} />
            <Fig label={t('Paid this year')} value={rupees(f.paidFyPaise)} line={f.lastPaymentAt ? `${t('last')} ${fmtDate(f.lastPaymentAt)}` : undefined} />
          </View>
          {f.overduePaise > 0 && (
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {f.aging.filter((a) => a.paise > 0).map((a) => (
                <View key={a.key} style={{ flex: 1, padding: 6, borderRadius: radius.sm, backgroundColor: a.tone === 'danger' ? c.dangerSoft : a.tone === 'warning' ? c.warningSoft : c.successSoft }}>
                  <Text variant="micro" color={c.inkSoft}>{t(a.key)}</Text>
                  <Text variant="small" weight="semibold">{rupees(a.paise)}</Text>
                </View>
              ))}
            </View>
          )}
          <Text variant="small" color={c.inkSoft}>
            {[f.openJobs ? `${f.openJobs} ${t('open jobs')}` : null, f.inWarranty ? `${f.inWarranty} ${t('items in warranty')}` : null,
              f.activeAmc ? `${t('AMC till')} ${fmtDate(f.activeAmc.endDate)}` : null, cu.creditLimitPaise ? `${t('Credit limit')} ${rupees(cu.creditLimitPaise)}` : null].filter(Boolean).join(' · ')}
          </Text>

          <Segmented value={tab} onChange={setTab} options={[
            { key: 'docs', label: `${t('Documents')} ${data.docs.length}` },
            { key: 'jobs', label: `${t('Jobs')} ${data.jobs.length}` },
            { key: 'items', label: `${t('Items')} ${data.items.length}` },
          ]} />
          {tab === 'docs' && data.docs.map((d) => (
            <Row key={`${d.type}-${d.id}`} title={`${t(DOC_LABEL[d.type] ?? d.type)} ${d.no}`}
              line={`${rupees(d.amountPaise)}${d.duePaise ? ` · ${rupees(d.duePaise)} ${t('due')}` : ''}`} meta={fmtDate(d.at)}
              onPress={() => openDoc(d)} right={<Pill label={t(d.status.label)} tone={toneOf(d.status.tone)} />} />
          ))}
          {tab === 'jobs' && data.jobs.map((j) => (
            <Row key={j.id} title={`${j.no} · ${j.item}`} line={j.techName ?? t('Nobody on it')}
              meta={`${fmtDate(j.at)}${j.nextVisit ? ` · ${t('Visit')} ${fmtDate(j.nextVisit)}` : ''}`}
              onPress={() => router.push({ pathname: '/employee/complaint/[id]', params: { id: j.id } })}
              right={<Pill label={t(j.status)} tone={toneOf(j.tone)} />} />
          ))}
          {tab === 'items' && data.items.map((u) => (
            <Row key={u.id} title={u.product} line={`${u.serial}${u.invoiceNo ? ` · ${u.invoiceNo}` : ''}`}
              meta={u.warrantyUntil ? `${t('Warranty till')} ${fmtDate(u.warrantyUntil)}` : t('No warranty on record')}
              right={u.amc ? <Pill label="AMC" tone="success" /> : undefined} />
          ))}
          <Pressable onPress={() => router.push({ pathname: '/owner/web', params: { next: `/customers/${cu.id}` } })} style={{ paddingVertical: space.sm }}>
            <Text variant="small" weight="semibold" color={c.brand} align="center">{t('Open on website')}</Text>
          </Pressable>
        </>
      )}
    </SubScreen>
  );
}

function Fig({ label, value, line, tone }: { label: string; value: string; line?: string; tone?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
      <Text variant="micro" color={c.inkSoft}>{label}</Text>
      <Text variant="h3" weight="bold" color={tone ?? c.ink}>{value}</Text>
      {line ? <Text variant="micro" color={c.muted}>{line}</Text> : null}
    </View>
  );
}
