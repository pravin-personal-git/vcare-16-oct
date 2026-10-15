import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { computeTotals } from '@shared/lib/quotation-totals';
import { evaluateRule, pricingOf, type Rule } from '@shared/lib/approval-rules';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, SectionLabel, SubScreen, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { SearchPicker } from '@/components/SearchPicker';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { createInvoice, numbersLeft, refreshNumbers, salesCatalogue, takeNumber, type Buyer, type CatalogueProduct, type NewLine } from '@/lib/sales';
import { shareInvoicePdf } from '@/lib/invoicePdf';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * NEW INVOICE on the phone (13 Oct 2026, native admin app part 3) - a sale on
 * the spot, signal or not.
 *
 *  - Customers and products from the phone's copy; totals from the website's
 *    own arithmetic (lib/quotation-totals).
 *  - Does it need approval? The website's own rule, run here
 *    (lib/approval-rules, decision S2). If yes it is saved WITHOUT a number
 *    and goes for approval when it reaches the office.
 *  - If not, it takes the next FINAL number this phone holds (F-13 Q3) - a
 *    real GST invoice number the customer can be handed now - and is issued
 *    when it reaches the office.
 *  - Money taken now goes with it. PDF made on the phone (S4).
 */
const METHODS: { key: string; label: string }[] = [
  { key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'card', label: 'Card' }, { key: 'bank', label: 'Bank' }, { key: 'cheque', label: 'Cheque' },
];

export default function NewInvoice() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => salesCatalogue(), []);
  const { data: cat, error, loading } = useLoad(load);
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [picking, setPicking] = useState<'party' | 'product' | null>(null);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [company, setCompany] = useState('');
  const [gstin, setGstin] = useState(''); const [address, setAddress] = useState(''); const [sameState, setSameState] = useState(true);
  const [lines, setLines] = useState<NewLine[]>([]);
  const [gstOn, setGstOn] = useState(true);
  const [discount, setDiscount] = useState(''); const [notes, setNotes] = useState('');
  const [payNow, setPayNow] = useState(''); const [method, setMethod] = useState('cash'); const [ref, setRef] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [done, setDone] = useState<{ number: string | null; held: boolean } | null>(null);

  useEffect(() => { void refreshNumbers().then(setLeft).catch(() => numbersLeft().then(setLeft)); }, []);

  const pickBuyer = (b: Buyer) => {
    setBuyer(b); setIsNew(false); setName(b.name); setPhone(b.phone.replace(/^\+?91\s*/, '')); setCompany(b.company ?? '');
    setGstin(b.gstin ?? ''); setAddress(b.address ?? ''); setSameState(!b.state || b.state === cat?.storeStateId); setPicking(null);
  };
  const addProduct = (p: CatalogueProduct) => {
    setLines((x) => [...x, { productId: p.id, productName: p.name, productCode: p.code, qty: 1, unitPricePaise: p.dlpPaise, discountPct: 0, taxRatePct: p.taxRatePct }]);
    setPicking(null);
  };
  const setLine = (i: number, patch: Partial<NewLine>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const taxMode = !gstOn ? 'NONE' as const : sameState ? 'CGST_SGST' as const : 'IGST' as const;
  const discountPaise = Math.round((Number(discount) || 0) * 100);
  const totals = useMemo(() => computeTotals(lines, { taxMode, discountType: 'amount', discountValue: discountPaise, deliveryPaise: 0, deliveryExempt: false }),
    [lines, taxMode, discountPaise]);
  const rule = (cat?.approval?.invoiceRule ?? null) as Rule | null;
  const needsApproval = !!rule && lines.length > 0 && !evaluateRule(rule, {
    userId: cat?.approval?.userId ?? '', roleIds: cat?.approval?.roleIds ?? [], amountPaise: totals.grandTotalPaise, ...pricingOf(totals),
  }).auto;
  const payPaise = Math.min(totals.grandTotalPaise, Math.round((Number(payNow) || 0) * 100));
  const stateId = sameState ? cat?.storeStateId ?? null : (buyer?.state && buyer.state !== cat?.storeStateId ? buyer.state : null);

  const pdfData = (number: string, draft: boolean) => ({
    title: draft ? 'DRAFT INVOICE' as const : 'TAX INVOICE' as const, number, date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    seller: cat?.seller ?? null,
    buyer: { name: name.trim(), company: company.trim() || null, phone: phone.trim(), gstin: gstin.trim() || null, address: address.trim() || null },
    lines: lines.map((l, i) => ({ name: l.productName, qty: l.qty, unitPricePaise: l.unitPricePaise, discountPct: l.discountPct, taxRatePct: l.taxRatePct, amountPaise: totals.lines[i]?.taxablePaise ?? 0 })),
    taxMode, subtotalPaise: totals.subtotalPaise, discountPaise: totals.itemDiscountPaise + totals.orderDiscountPaise, taxablePaise: totals.taxableBasePaise,
    cgstPaise: totals.cgstPaise, sgstPaise: totals.sgstPaise, igstPaise: totals.igstPaise, deliveryPaise: 0, grandTotalPaise: totals.grandTotalPaise,
    paidPaise: draft ? 0 : payPaise, note: notes.trim() || null,
  });

  const save = async () => {
    setMsg(null);
    if (!name.trim()) { setMsg({ tone: 'danger', text: t('Customer name is required.') }); return; }
    if (!/^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10))) { setMsg({ tone: 'danger', text: t('Mobile must be a 10-digit number.') }); return; }
    if (!lines.length) { setMsg({ tone: 'danger', text: t('Add at least one product.') }); return; }
    setBusy(true);
    try {
      // Approval needed: no number from the phone - it is numbered and approved at the office.
      const number = needsApproval ? null : await takeNumber();
      const r = await createInvoice({
        partyId: buyer?.id ?? null, newCustomer: isNew || !buyer, customerName: name.trim(), organizationName: company.trim() || null,
        phone: phone.replace(/\D/g, '').slice(-10), email: buyer?.email ?? null, gstin: gstin.trim() || null, billingAddress: address.trim() || null,
        stateId, noGst: !gstOn, discountType: 'amount', discountValue: discountPaise, deliveryPaise: 0, notes: notes.trim() || null, lines,
        invoiceDate: new Date().toISOString(), termsDays: 0, invoiceNo: number, issue: true,
        payment: payPaise > 0 && !needsApproval ? { amountPaise: payPaise, method, reference: ref.trim() || null } : null,
      });
      if (!r) return;
      const finalNo = isQueued(r) ? number : r.invoiceNo;
      setDone({ number: finalNo, held: needsApproval || (!isQueued(r) && r.held) });
      setMsg({ tone: isQueued(r) ? 'warning' : 'success', text: isQueued(r) ? t(r.message) : t(r.message) });
      void numbersLeft().then(setLeft);
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not save the invoice. Please try again.') });
    } finally { setBusy(false); }
  };

  const input = (value: string, set: (v: string) => void, placeholder: string, opts: { numeric?: boolean; flex?: number } = {}) => (
    <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={c.muted} keyboardType={opts.numeric ? 'decimal-pad' : 'default'}
      style={[typeScale.body, { flex: opts.flex, fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.surface }]} />
  );

  if (done) {
    return (
      <SubScreen title={t('Invoice saved')}>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Card style={{ gap: space.sm, alignItems: 'center' }}>
          <Icon name={done.held ? 'clock' : 'check'} size={40} color={done.held ? c.warning : c.success} />
          <Text variant="h2" weight="bold">{done.number ?? t('Number from the office')}</Text>
          <Text color={c.inkSoft} align="center">{done.held ? t('Waits for approval - the customer gets the invoice once it is approved.') : `${rupees(totals.grandTotalPaise)} · ${name}`}</Text>
        </Card>
        {done.number && <Button label={done.held ? t('Share draft PDF') : t('Share invoice PDF')} icon="send" onPress={() => void shareInvoicePdf(pdfData(done.number!, done.held))} />}
        <Button label={t('New invoice')} icon="plus" variant="secondary" onPress={() => router.replace('/sales/invoice-new')} />
        <Button label={t('Invoices')} variant="ghost" onPress={() => router.replace('/sales/invoices')} />
      </SubScreen>
    );
  }

  return (
    <SubScreen title={t('New invoice')} footer={
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row' }}>
          <Text weight="bold" style={{ flex: 1 }}>{t('Total')}</Text>
          <Text variant="h3" weight="bold">{rupees(totals.grandTotalPaise)}</Text>
        </View>
        <Button label={needsApproval ? t('Save - send for approval') : t('Save invoice')} icon="check" loading={busy} onPress={() => void save()} />
      </View>
    }>
      {error && <Banner tone="danger">{error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {needsApproval
        ? <Banner tone="warning">{t('This invoice needs approval (amount or discount). It is saved without a number and numbered when approved.')}</Banner>
        : left !== null && <Text variant="small" color={left > 0 ? c.inkSoft : c.danger}>{left > 0 ? `${left} ${t('invoice numbers ready on this phone')}` : t('No invoice numbers on this phone - it will be numbered when it reaches the office.')}</Text>}
      {loading && !cat ? <Loading /> : cat && (
        <>
          <SectionLabel>{t('Customer')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label={buyer ? t('Change') : t('Pick customer')} icon="search" variant="secondary" onPress={() => setPicking('party')} /></View>
            {!isNew && <View style={{ flex: 1 }}><Button label={t('New customer')} icon="plus" variant="ghost" onPress={() => { setBuyer(null); setIsNew(true); setName(''); setPhone(''); setCompany(''); setGstin(''); setAddress(''); setSameState(true); }} /></View>}
          </View>
          {(buyer || isNew) && (
            <Card style={{ gap: space.sm }}>
              {buyer && <Text variant="small" color={c.brand} weight="semibold">{`${t('Customer')} ${buyer.code}`}</Text>}
              {input(name, setName, t('Name'))}
              {input(phone, setPhone, t('Mobile (10 digits)'), { numeric: true })}
              {input(company, setCompany, t('Company (optional)'))}
              {input(gstin, setGstin, t('GSTIN (optional)'))}
              {input(address, setAddress, t('Address (optional)'))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text style={{ flex: 1 }}>{t('Customer is in our state (CGST + SGST)')}</Text>
                <Switch value={sameState} onValueChange={setSameState} />
              </View>
            </Card>
          )}

          <SectionLabel>{t('Items')}</SectionLabel>
          {lines.map((l, i) => (
            <Card key={`${l.productId}-${i}`} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text weight="semibold" style={{ flex: 1 }}>{l.productName}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Remove this item')} onPress={() => setLines((x) => x.filter((_, j) => j !== i))} hitSlop={10}><Icon name="trash" size={18} color={c.danger} /></Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('One less')} onPress={() => setLine(i, { qty: Math.max(1, l.qty - 1) })} style={{ width: 44, height: 44, borderRadius: 20, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}><Text variant="h3">−</Text></Pressable>
                <Text variant="h3" weight="bold" style={{ minWidth: 36, textAlign: 'center' }}>{String(l.qty)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('One more')} onPress={() => setLine(i, { qty: l.qty + 1 })} style={{ width: 44, height: 44, borderRadius: 20, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}><Text variant="h3">+</Text></Pressable>
                <Text variant="small" color={c.inkSoft} style={{ marginStart: 'auto' }}>{`GST ${l.taxRatePct}%`}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 2, gap: 2 }}>
                  <Text variant="micro" color={c.inkSoft}>{t('Rate (₹)')}</Text>
                  {input(String(l.unitPricePaise / 100), (v) => setLine(i, { unitPricePaise: Math.round((Number(v) || 0) * 100) }), '0', { numeric: true })}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="micro" color={c.inkSoft}>{t('Discount %')}</Text>
                  {input(l.discountPct ? String(l.discountPct) : '', (v) => setLine(i, { discountPct: Math.max(0, Math.min(100, Number(v) || 0)) }), '0', { numeric: true })}
                </View>
              </View>
              <Text variant="small" weight="semibold" style={{ alignSelf: 'flex-end' }}>{rupees(totals.lines[i]?.taxablePaise ?? 0)}</Text>
            </Card>
          ))}
          <Button label={t('Add product')} icon="plus" variant="secondary" onPress={() => setPicking('product')} />

          <SectionLabel>{t('Totals')}</SectionLabel>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={{ flex: 1 }}>{t('Charge GST')}</Text>
              <Switch value={gstOn} onValueChange={setGstOn} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Text style={{ flex: 1 }}>{t('Discount on the whole (₹)')}</Text>
              {input(discount, setDiscount, '0', { numeric: true, flex: 1 })}
            </View>
            <Sum label={t('Subtotal')} v={totals.subtotalPaise} />
            {totals.itemDiscountPaise + totals.orderDiscountPaise > 0 && <Sum label={t('Discount')} v={-(totals.itemDiscountPaise + totals.orderDiscountPaise)} />}
            {taxMode === 'IGST' ? <Sum label="IGST" v={totals.igstPaise} /> : taxMode === 'CGST_SGST' ? <><Sum label="CGST" v={totals.cgstPaise} /><Sum label="SGST" v={totals.sgstPaise} /></> : null}
          </Card>

          {!needsApproval && (
            <>
              <SectionLabel>{t('Payment now')}</SectionLabel>
              <Card style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Text style={{ flex: 1 }}>{t('Amount received (₹)')}</Text>
                  {input(payNow, setPayNow, '0', { numeric: true, flex: 1 })}
                </View>
                <Pressable onPress={() => setPayNow(String(totals.grandTotalPaise / 100))}><Text variant="small" weight="semibold" color={c.brand}>{t('Paid in full')}</Text></Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {METHODS.map((m) => (
                    <Pressable key={m.key} onPress={() => setMethod(m.key)} style={{ paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: method === m.key ? c.brand : c.line, backgroundColor: method === m.key ? c.brandSoft : c.surface }}>
                      <Text variant="small" weight="semibold" color={method === m.key ? c.brand : c.inkSoft}>{t(m.label)}</Text>
                    </Pressable>
                  ))}
                </View>
                {method !== 'cash' && input(ref, setRef, t('UTR / cheque no. (optional)'))}
              </Card>
            </>
          )}
          {input(notes, setNotes, t('Note (optional)'))}
        </>
      )}
      <SearchPicker visible={picking === 'party'} title={t('Customer')} onClose={() => setPicking(null)}
        items={(cat?.buyers ?? []).map((b) => ({ key: b.id, title: b.company ? `${b.name} · ${b.company}` : b.name, line: `${b.code} · ${b.phone}${b.city ? ` · ${b.city}` : ''}`, hay: `${b.name} ${b.company ?? ''} ${b.phone} ${b.code}`, pick: () => pickBuyer(b) }))} />
      <SearchPicker visible={picking === 'product'} title={t('Product')} onClose={() => setPicking(null)}
        items={(cat?.products ?? []).map((p) => ({
          key: p.id, title: p.name, line: `${p.code} · ${rupees(p.dlpPaise)} · ${t('in stock')} ${Math.max(0, p.stock - p.promised)}`,
          hay: `${p.name} ${p.code} ${p.barcode ?? ''} ${p.category ?? ''}`, pick: () => addProduct(p),
        }))} />
    </SubScreen>
  );
}

function Sum({ label, v }: { label: string; v: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text variant="small" color={c.inkSoft} style={{ flex: 1 }}>{label}</Text>
      <Text variant="small" weight="medium">{v < 0 ? `- ${rupees(-v)}` : rupees(v)}</Text>
    </View>
  );
}
