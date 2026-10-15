import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, SectionLabel, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Waiting } from '@/components/OfflineBar';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { order, orderToInvoice } from '@/lib/sales';
import { space } from '@/theme/tokens';

/**
 * ONE SALES ORDER on the phone (13 Oct 2026, native admin app part 3): what
 * was ordered, the totals, and Make the invoice (issued straight away through
 * the approval gate, as on the website). The order's stages stay on the
 * website for now - "Open on website".
 */
export default function OrderPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => order(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const o = data?.order;

  const makeInvoice = async () => {
    if (!o) return;
    setBusy(true); setMsg(null);
    try {
      const r = await orderToInvoice(o.id, true);
      if (isQueued(r)) setMsg({ tone: 'warning', text: t(r.message) });
      else if (r) {
        setMsg({ tone: 'success', text: t(r.message) });
        router.push({ pathname: '/sales/invoice/[id]', params: { id: r.invoiceId } });
      }
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally { setBusy(false); }
  };

  return (
    <SubScreen title={o?.orderNo ?? t('Sales order')} subtitle={o ? (o.organizationName || o.customerName) : undefined} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !o ? <Loading /> : o && (
        <>
          <Waiting target={`order:${o.id}`} />
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          <Card style={{ gap: space.xs }}>
            <Text variant="small" color={c.inkSoft}>{`${fmtDate(o.orderDate)}${o.quotationNo ? ` · ${t('from')} ${o.quotationNo}` : ''}${o.expectedDeliveryDate ? ` · ${t('delivery')} ${fmtDate(o.expectedDeliveryDate)}` : ''}`}</Text>
            <Text weight="semibold">{o.customerName}{o.organizationName ? ` · ${o.organizationName}` : ''}</Text>
            <Text variant="small" color={c.inkSoft}>{[o.phone, o.gstin ? `GSTIN ${o.gstin}` : null].filter(Boolean).join(' · ')}</Text>
            <Text variant="h3" weight="bold">{rupees(o.grandTotalPaise)}</Text>
            {data?.invoice && <Text weight="semibold" color={c.success}>{`${t('Invoice')} ${data.invoice.invoiceNo}`}</Text>}
          </Card>
          <SectionLabel>{t('Items')}</SectionLabel>
          {o.items.map((l) => (
            <View key={l.srNo} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <View style={{ flex: 1 }}>
                <Text weight="medium">{l.productName}</Text>
                <Text variant="small" color={c.inkSoft}>{`${l.qty} × ${rupees(l.unitPricePaise)}${l.discountPct ? ` - ${l.discountPct}%` : ''} · GST ${l.taxRatePct}%`}</Text>
              </View>
              <Text weight="semibold">{rupees(l.lineTotalPaise)}</Text>
            </View>
          ))}
          {data?.invoice
            ? <Button label={t('Open the invoice')} icon="file" variant="secondary" onPress={() => router.push({ pathname: '/sales/invoice/[id]', params: { id: data.invoice!.id } })} />
            : data?.can.invoice && <Button label={t('Make the invoice')} icon="file" loading={busy} onPress={() => void makeInvoice()} />}
          <Button label={t('Open on website')} icon="globe" variant="ghost" onPress={() => router.push({ pathname: '/owner/web', params: { next: `/sales/orders/${o.id}` } })} />
        </>
      )}
    </SubScreen>
  );
}
