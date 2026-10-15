import { useCallback, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, Pill, SectionLabel, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { Waiting } from '@/components/OfflineBar';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { invoice, invoiceLink, invoicePayment, invoiceTone, issueInvoice } from '@/lib/sales';
import { shareInvoicePdf } from '@/lib/invoicePdf';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * ONE INVOICE on the phone (13 Oct 2026, native admin app part 3): items and
 * totals as saved, payments, and the buttons - issue a draft, take a payment
 * (works offline), WhatsApp the link, share the PDF made on the phone.
 */
const METHODS = ['cash', 'upi', 'card', 'bank', 'cheque'];
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', cheque: 'Cheque' };

export default function InvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => invoice(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState('cash'); const [ref, setRef] = useState('');
  const [now] = useState(() => new Date().getTime());
  const inv = data?.invoice;
  const duePaise = inv ? Math.max(0, inv.grandTotalPaise - inv.amountPaidPaise) : 0;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      if (isQueued(r)) setMsg({ tone: 'warning', text: t(r.message) });
      else if (r) setMsg({ tone: 'success', text: t((r as { message?: string }).message ?? 'Saved.') });
      setPaying(false); setAmount(''); setRef('');
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally { setBusy(null); }
  };

  const shareLink = async () => {
    if (!inv) return;
    setBusy('link'); setMsg(null);
    try {
      const r = await invoiceLink(inv.id);
      if (!r) return;
      const digits = inv.phone.replace(/\D/g, '').slice(-10);
      const text = `${inv.customerName}, ${t('your invoice')} ${inv.invoiceNo} - ${rupees(inv.grandTotalPaise)}${duePaise ? ` (${rupees(duePaise)} ${t('due')})` : ''}: ${r.url}`;
      await Linking.openURL(`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`);
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError && e.status !== 0 ? t(e.message) : t('Sharing the link needs signal. Share the PDF instead.') });
    } finally { setBusy(null); }
  };

  const pdf = () => {
    if (!inv) return;
    void shareInvoicePdf({
      title: inv.lifecycle === 'draft' ? 'DRAFT INVOICE' : 'TAX INVOICE', number: inv.invoiceNo, date: fmtDate(inv.invoiceDate),
      seller: { name: inv.org.name, gstin: inv.org.gstin, mobile: inv.org.mobile, email: inv.org.email, storeName: inv.storeName, storeAddress: inv.storeAddress },
      buyer: { name: inv.customerName, company: inv.organizationName, phone: inv.phone, gstin: inv.gstin, address: inv.billingAddress },
      lines: inv.items.map((l) => ({ name: l.productName, qty: l.qty, unitPricePaise: l.unitPricePaise, discountPct: l.discountPct, taxRatePct: l.taxRatePct, amountPaise: l.lineTotalPaise })),
      taxMode: inv.taxMode, subtotalPaise: inv.subtotalPaise, discountPaise: inv.itemDiscountPaise + inv.orderDiscountPaise, taxablePaise: inv.taxableBasePaise,
      cgstPaise: inv.cgstPaise, sgstPaise: inv.sgstPaise, igstPaise: inv.igstPaise, deliveryPaise: Math.max(0, inv.grandTotalPaise - inv.taxableBasePaise - inv.cgstPaise - inv.sgstPaise - inv.igstPaise),
      grandTotalPaise: inv.grandTotalPaise, paidPaise: inv.amountPaidPaise,
    }).catch(() => setMsg({ tone: 'danger', text: t('Could not make the PDF.') }));
  };

  const s = inv ? invoiceTone(inv, now) : null;
  return (
    <SubScreen title={inv?.invoiceNo ?? t('Invoice')} subtitle={inv ? (inv.organizationName || inv.customerName) : undefined} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !inv ? <Loading /> : inv && s && (
        <>
          <Waiting target={`invoice:${inv.id}`} />
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          <Card style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pill label={t(s.label)} tone={s.tone} />
              <Text variant="small" color={c.inkSoft} style={{ flex: 1 }}>{`${fmtDate(inv.invoiceDate)} · ${t('due')} ${fmtDate(inv.dueDate)}`}</Text>
            </View>
            <Text weight="semibold">{inv.customerName}{inv.organizationName ? ` · ${inv.organizationName}` : ''}</Text>
            <Text variant="small" color={c.inkSoft}>{[inv.phone, inv.gstin ? `GSTIN ${inv.gstin}` : null].filter(Boolean).join(' · ')}</Text>
            <Text variant="h3" weight="bold">{rupees(inv.grandTotalPaise)}</Text>
            {inv.lifecycle === 'sent' && <Text weight="semibold" color={duePaise ? c.danger : c.success}>{duePaise ? `${rupees(duePaise)} ${t('due')}` : t('Fully paid')}</Text>}
          </Card>

          <SectionLabel>{t('Items')}</SectionLabel>
          {inv.items.map((l) => (
            <View key={l.srNo} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <View style={{ flex: 1 }}>
                <Text weight="medium">{l.productName}</Text>
                <Text variant="small" color={c.inkSoft}>{`${l.qty} × ${rupees(l.unitPricePaise)}${l.discountPct ? ` - ${l.discountPct}%` : ''} · GST ${l.taxRatePct}%`}</Text>
              </View>
              <Text weight="semibold">{rupees(l.lineTotalPaise)}</Text>
            </View>
          ))}
          <Card style={{ gap: 4 }}>
            <Line label={t('Taxable')} v={rupees(inv.taxableBasePaise)} />
            {inv.taxMode === 'IGST' ? <Line label="IGST" v={rupees(inv.igstPaise)} /> : inv.taxMode === 'NONE' ? null
              : <><Line label="CGST" v={rupees(inv.cgstPaise)} /><Line label="SGST" v={rupees(inv.sgstPaise)} /></>}
            <Line label={t('Total')} v={rupees(inv.grandTotalPaise)} strong />
          </Card>
          {inv.payments.length > 0 && <SectionLabel>{t('Payments')}</SectionLabel>}
          {inv.payments.map((p) => (
            <Text key={p.id} variant="small" color={c.inkSoft}>{`${fmtDate(p.paidAt)} · ${t(METHOD_LABEL[p.method] ?? p.method)} · ${rupees(p.amountPaise)}`}</Text>
          ))}

          {inv.lifecycle === 'draft' && data?.can.issue && (
            <Button label={t('Issue invoice')} icon="check" loading={busy === 'issue'} onPress={() => void run('issue', () => issueInvoice(inv.id))} />
          )}
          {inv.lifecycle === 'sent' && duePaise > 0 && data?.can.payment && !paying && (
            <Button label={t('Take payment')} icon="plus" onPress={() => { setPaying(true); setAmount(String(duePaise / 100)); }} />
          )}
          {paying && (
            <Card style={{ gap: space.sm }}>
              <Text weight="semibold">{t('Payment received')}</Text>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0"
                style={[typeScale.body, { fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.surface }]} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {METHODS.map((m) => (
                  <Pressable key={m} onPress={() => setMethod(m)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: method === m ? c.brand : c.line, backgroundColor: method === m ? c.brandSoft : c.surface }}>
                    <Text variant="small" weight="semibold" color={method === m ? c.brand : c.inkSoft}>{t(METHOD_LABEL[m]!)}</Text>
                  </Pressable>
                ))}
              </View>
              {method !== 'cash' && (
                <TextInput value={ref} onChangeText={setRef} placeholder={t('UTR / cheque no. (optional)')} placeholderTextColor={c.muted}
                  style={[typeScale.body, { fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.surface }]} />
              )}
              <Button label={t('Save payment')} icon="check" loading={busy === 'pay'}
                onPress={() => void run('pay', () => invoicePayment(inv.id, { amountPaise: Math.round((Number(amount) || 0) * 100), method, reference: ref.trim() || null }))} />
              <Button label={t('Cancel')} variant="ghost" onPress={() => setPaying(false)} />
            </Card>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label={t('WhatsApp link')} icon="send" variant="secondary" loading={busy === 'link'} onPress={() => void shareLink()} /></View>
            <View style={{ flex: 1 }}><Button label={t('PDF')} icon="file" variant="secondary" onPress={pdf} /></View>
          </View>
          <Button label={t('Open on website')} icon="globe" variant="ghost" onPress={() => router.push({ pathname: '/owner/web', params: { next: `/invoices/${inv.id}` } })} />
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
