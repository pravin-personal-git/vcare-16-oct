import { useCallback, useMemo, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { computeTotals } from '@shared/lib/quotation-totals';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Loading, SectionLabel, SubScreen, rupees, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { SearchPicker } from '@/components/SearchPicker';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { createQuotation, salesCatalogue, type Buyer, type CatalogueProduct, type LeadPick, type NewLine } from '@/lib/sales';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * NEW QUOTATION on the phone (13 Oct 2026, native admin app - sales part 1).
 * Works with no signal: customers, leads and products come from the phone's
 * copy of the catalogue, totals from the website's own arithmetic
 * (lib/quotation-totals - discounts, then GST, then delivery). Saved through
 * the outbox; the number is given when it reaches the office, and the
 * server works the totals out again from the lines.
 */
type Party = { kind: 'customer'; b: Buyer } | { kind: 'lead'; l: LeadPick } | { kind: 'new' };

export default function NewQuotation() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => salesCatalogue(), []);
  const { data: cat, error, loading } = useLoad(load);
  const [party, setParty] = useState<Party | null>(null);
  const [picking, setPicking] = useState<'party' | 'product' | null>(null);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [company, setCompany] = useState('');
  const [gstin, setGstin] = useState(''); const [address, setAddress] = useState(''); const [sameState, setSameState] = useState(true);
  const [lines, setLines] = useState<NewLine[]>([]);
  const [gstOn, setGstOn] = useState(true);
  const [discount, setDiscount] = useState(''); const [delivery, setDelivery] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  const pickBuyer = (b: Buyer) => {
    setParty({ kind: 'customer', b }); setName(b.name); setPhone(b.phone.replace(/^\+?91\s*/, '')); setCompany(b.company ?? '');
    setGstin(b.gstin ?? ''); setAddress(b.address ?? ''); setSameState(!b.state || b.state === cat?.storeStateId); setPicking(null);
  };
  const pickLead = (l: LeadPick) => {
    setParty({ kind: 'lead', l }); setName(l.name); setPhone(l.phone.replace(/^\+?91\s*/, '')); setCompany(l.company ?? '');
    setSameState(!l.state || l.state === cat?.storeStateId); setPicking(null);
  };
  const addProduct = (p: CatalogueProduct) => {
    setLines((x) => [...x, { productId: p.id, productName: p.name, productCode: p.code, qty: 1, unitPricePaise: p.dlpPaise, discountPct: 0, taxRatePct: p.taxRatePct }]);
    setPicking(null);
  };
  const setLine = (i: number, patch: Partial<NewLine>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const stateId = sameState ? cat?.storeStateId ?? null : (party?.kind === 'customer' && party.b.state && party.b.state !== cat?.storeStateId ? party.b.state : null);
  const taxMode = !gstOn ? 'NONE' as const : sameState ? 'CGST_SGST' as const : 'IGST' as const;
  const discountPaise = Math.round((Number(discount) || 0) * 100);
  const deliveryPaise = Math.round((Number(delivery) || 0) * 100);
  const totals = useMemo(() => computeTotals(lines, { taxMode, discountType: 'amount', discountValue: discountPaise, deliveryPaise, deliveryExempt: false }),
    [lines, taxMode, discountPaise, deliveryPaise]);

  const save = async () => {
    setMsg(null);
    if (!name.trim()) { setMsg({ tone: 'danger', text: t('Customer name is required.') }); return; }
    if (!/^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10))) { setMsg({ tone: 'danger', text: t('Mobile must be a 10-digit number.') }); return; }
    if (!lines.length) { setMsg({ tone: 'danger', text: t('Add at least one product.') }); return; }
    setBusy(true);
    try {
      const r = await createQuotation({
        leadId: party?.kind === 'lead' ? party.l.id : null, partyId: party?.kind === 'customer' ? party.b.id : null,
        customerName: name.trim(), organizationName: company.trim() || null, phone: phone.replace(/\D/g, '').slice(-10),
        email: party?.kind === 'customer' ? party.b.email : party?.kind === 'lead' ? party.l.email : null,
        gstin: gstin.trim() || null, billingAddress: address.trim() || null, stateId, noGst: !gstOn,
        discountType: 'amount', discountValue: discountPaise, deliveryPaise, validityPeriodDays: 15, notes: notes.trim() || null, lines,
      });
      if (!r) return;
      if (isQueued(r)) { setMsg({ tone: 'warning', text: t(r.message) }); setTimeout(() => router.back(), 1500); return; }
      router.replace({ pathname: '/sales/quotation/[id]', params: { id: r.id } });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not save the quotation. Please try again.') });
    } finally { setBusy(false); }
  };

  const input = (value: string, set: (v: string) => void, placeholder: string, opts: { numeric?: boolean; flex?: number } = {}) => (
    <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={c.muted} keyboardType={opts.numeric ? 'decimal-pad' : 'default'}
      style={[typeScale.body, { flex: opts.flex, fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: c.surface }]} />
  );

  return (
    <SubScreen title={t('New quotation')} footer={
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row' }}>
          <Text weight="bold" style={{ flex: 1 }}>{t('Total')}</Text>
          <Text variant="h3" weight="bold">{rupees(totals.grandTotalPaise)}</Text>
        </View>
        <Button label={t('Save quotation')} icon="check" loading={busy} onPress={() => void save()} />
      </View>
    }>
      {error && <Banner tone="danger">{error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {loading && !cat ? <Loading /> : cat && (
        <>
          <SectionLabel>{t('Customer')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label={party && party.kind !== 'new' ? t('Change') : t('Pick customer or lead')} icon="search" variant="secondary" onPress={() => setPicking('party')} /></View>
            {(!party || party.kind !== 'new') && <View style={{ flex: 1 }}><Button label={t('New customer')} icon="plus" variant="ghost" onPress={() => { setParty({ kind: 'new' }); setName(''); setPhone(''); setCompany(''); setGstin(''); setAddress(''); setSameState(true); }} /></View>}
          </View>
          {party && (
            <Card style={{ gap: space.sm }}>
              {party.kind !== 'new' && <Text variant="small" color={c.brand} weight="semibold">{party.kind === 'customer' ? `${t('Customer')} ${party.b.code}` : `${t('Lead')} ${party.l.code}`}</Text>}
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
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Text style={{ flex: 1 }}>{t('Delivery (₹)')}</Text>
              {input(delivery, setDelivery, '0', { numeric: true, flex: 1 })}
            </View>
            <Sum label={t('Subtotal')} v={totals.subtotalPaise} />
            {totals.itemDiscountPaise + totals.orderDiscountPaise > 0 && <Sum label={t('Discount')} v={-(totals.itemDiscountPaise + totals.orderDiscountPaise)} />}
            {taxMode === 'IGST' ? <Sum label="IGST" v={totals.igstPaise} /> : taxMode === 'CGST_SGST' ? <><Sum label="CGST" v={totals.cgstPaise} /><Sum label="SGST" v={totals.sgstPaise} /></> : null}
            {deliveryPaise > 0 && <Sum label={t('Delivery')} v={totals.deliveryPaise} />}
          </Card>
          {input(notes, setNotes, t('Note (optional)'))}
          <Text variant="micro" color={c.muted}>{`${t('Prices as of')} ${new Date(cat.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}</Text>
        </>
      )}
      <SearchPicker visible={picking === 'party'} title={t('Customer or lead')} onClose={() => setPicking(null)}
        items={[
          ...(cat?.buyers ?? []).map((b) => ({ key: `b${b.id}`, title: b.company ? `${b.name} · ${b.company}` : b.name, line: `${b.code} · ${b.phone}${b.city ? ` · ${b.city}` : ''}`, hay: `${b.name} ${b.company ?? ''} ${b.phone} ${b.code}`, pick: () => pickBuyer(b) })),
          ...(cat?.leads ?? []).map((l) => ({ key: `l${l.id}`, title: `${l.name}${l.company ? ` · ${l.company}` : ''}`, line: `${t('Lead')} ${l.code} · ${l.phone}`, hay: `${l.name} ${l.company ?? ''} ${l.phone} ${l.code}`, pick: () => pickLead(l) })),
        ]} />
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
