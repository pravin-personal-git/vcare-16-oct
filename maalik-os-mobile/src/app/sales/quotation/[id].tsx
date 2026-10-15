import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, Pill, SectionLabel, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Waiting } from '@/components/OfflineBar';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { quotation, quotationLink, quotationStatus, quotationToOrder, STATUS_LABEL, STATUS_TONE } from '@/lib/sales';
import { space } from '@/theme/tokens';

/**
 * ONE QUOTATION on the phone (13 Oct 2026, native admin app - sales part 1):
 * who, what, the totals as saved, and the buttons the website has - mark
 * sent / accepted / rejected, share on WhatsApp, make it an order.
 */
export default function QuotationPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => quotation(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const q = data?.quotation;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      if (isQueued(r)) setMsg({ tone: 'warning', text: t(r.message) });
      else if (r) setMsg({ tone: 'success', text: t((r as { message?: string }).message ?? 'Saved.') });
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally { setBusy(null); }
  };

  const share = async () => {
    if (!q) return;
    setBusy('share'); setMsg(null);
    try {
      const r = await quotationLink(q.id);
      if (!r) return;
      const digits = q.phone.replace(/\D/g, '').slice(-10);
      const text = `${q.customerName}, ${t('your quotation')} ${q.quotationNo} - ${rupees(q.grandTotalPaise)}: ${r.url}`;
      await Linking.openURL(`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`);
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError && e.status !== 0 ? t(e.message) : t('Sharing the link needs signal.') });
    } finally { setBusy(null); }
  };

  return (
    <SubScreen title={q?.quotationNo ?? t('Quotation')} subtitle={q ? (q.organizationName || q.customerName) : undefined} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !q ? <Loading /> : q && (
        <>
          <Waiting target={`quotation:${q.id}`} />
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          <Card style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pill label={t(STATUS_LABEL[q.status])} tone={STATUS_TONE[q.status]} />
              <Text variant="small" color={c.inkSoft} style={{ flex: 1 }}>{`${fmtDate(q.quotationDate)} · ${t('valid till')} ${fmtDate(q.validUntil)}`}</Text>
            </View>
            <Text weight="semibold">{q.customerName}{q.organizationName ? ` · ${q.organizationName}` : ''}</Text>
            <Text variant="small" color={c.inkSoft}>{[q.phone, q.gstin ? `GSTIN ${q.gstin}` : null, q.billingAddress].filter(Boolean).join(' · ')}</Text>
            {q.salespersonName && <Text variant="small" color={c.muted}>{`${t('Salesperson')}: ${q.salespersonName}`}</Text>}
            {data?.order && <Text variant="small" weight="semibold" color={c.success}>{`${t('Order')} ${data.order.orderNo}`}</Text>}
          </Card>

          <SectionLabel>{t('Items')}</SectionLabel>
          {q.items.map((l) => (
            <View key={l.srNo} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <View style={{ flex: 1 }}>
                <Text weight="medium">{l.productName}</Text>
                <Text variant="small" color={c.inkSoft}>{`${l.qty} × ${rupees(l.unitPricePaise)}${l.discountPct ? ` - ${l.discountPct}%` : ''} · GST ${l.taxRatePct}%`}</Text>
              </View>
              <Text weight="semibold">{rupees(l.lineTotalPaise)}</Text>
            </View>
          ))}
          <Card style={{ gap: 4 }}>
            <Line label={t('Subtotal')} v={rupees(q.subtotalPaise)} />
            {q.itemDiscountPaise + q.orderDiscountPaise > 0 && <Line label={t('Discount')} v={`- ${rupees(q.itemDiscountPaise + q.orderDiscountPaise)}`} />}
            <Line label={t('Taxable')} v={rupees(q.taxableBasePaise)} />
            {q.taxMode === 'IGST' ? <Line label="IGST" v={rupees(q.igstPaise)} /> : q.taxMode === 'NONE' ? <Line label={t('No GST')} v="-" />
              : <><Line label="CGST" v={rupees(q.cgstPaise)} /><Line label="SGST" v={rupees(q.sgstPaise)} /></>}
            <Line label={t('Total')} v={rupees(q.grandTotalPaise)} strong />
          </Card>

          <Button label={t('Share on WhatsApp')} icon="send" variant="secondary" loading={busy === 'share'} onPress={() => void share()} />
          {data?.can.edit && q.status !== 'converted' && (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {q.status === 'draft' && <View style={{ flex: 1 }}><Button label={t('Mark sent')} variant="secondary" loading={busy === 'sent'} onPress={() => void run('sent', () => quotationStatus(q.id, 'sent'))} /></View>}
              {q.status !== 'accepted' && <View style={{ flex: 1 }}><Button label={t('Accepted')} variant="secondary" loading={busy === 'accepted'} onPress={() => void run('accepted', () => quotationStatus(q.id, 'accepted'))} /></View>}
              {q.status !== 'rejected' && <View style={{ flex: 1 }}><Button label={t('Rejected')} variant="ghost" loading={busy === 'rejected'} onPress={() => void run('rejected', () => quotationStatus(q.id, 'rejected'))} /></View>}
            </View>
          )}
          {data?.can.convert && (
            <Button label={t('Make it a sales order')} icon="arrowRight" loading={busy === 'convert'} onPress={() => void run('convert', () => quotationToOrder(q.id))} />
          )}
          <Button label={t('Open on website')} icon="globe" variant="ghost" onPress={() => router.push({ pathname: '/owner/web', params: { next: `/quotation/${q.id}` } })} />
        </>
      )}
    </SubScreen>
  );
}

function Line({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text variant={strong ? 'body' : 'small'} weight={strong ? 'bold' : 'regular'} color={strong ? c.ink : c.inkSoft} style={{ flex: 1 }}>{label}</Text>
      <Text variant={strong ? 'body' : 'small'} weight={strong ? 'bold' : 'medium'}>{v}</Text>
    </View>
  );
}
