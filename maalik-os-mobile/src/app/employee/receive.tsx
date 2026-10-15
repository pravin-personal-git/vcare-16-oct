import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { Pill, Row, SectionLabel, SubScreen } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import {
  createProductFromScan, lookupCode, matchBillLines, productFormOptions, readPhoto, receiveGoods, searchProducts, searchSuppliers,
  type ProductHit, type Supplier,
} from '@/lib/jobs';
import { ApiError } from '@/lib/api';
import { space } from '@/theme/tokens';
import { can, useAccess } from '@/lib/access';

interface Line { key: string; product: ProductHit; qty: string; rate: string; serials: string[] }

/** The quick "new product" form, opened from a barcode Atlas has never seen (Scan-to-Stock G2). */
interface NewProduct {
  barcode: string | null; name: string; categoryId: string | null; trackingMode: string; sell: string; cost: string;
  /** Opened from a bill line (G7): replaces that suggestion when saved. */
  fromBillLine?: number;
}
const TRACKING_CHOICES = [['serial', 'One per box (serial)'], ['quantity', 'By quantity'], ['batch', 'By batch'], ['none', 'Not stocked']] as const;
/** A retail barcode: 8, 12, 13 or 14 digits with a correct GS1 check digit (same rule as lib/scan/decode on the website). */
const isRetailBarcode = (c: string) => {
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false;
  let sum = 0;
  for (let i = c.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(c[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(c[c.length - 1]);
};

/**
 * Receive a delivery at the door: supplier, their bill number, and each
 * product with its serials scanned one after another. The supplier's bill can
 * be photographed to fill the bill number and suggest the lines (AI). The
 * server checks every serial (never twice, never already on file) before a
 * receipt number is used.
 */
export default function Receive() {
  const { t } = useT();
  const { c } = useTheme();
  const [supplierQ, setSupplierQ] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [billNo, setBillNo] = useState('');
  const [productQ, setProductQ] = useState('');
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [scanFor, setScanFor] = useState<string | 'product' | null>(null);
  const [photo, setPhoto] = useState(false);
  // Settings > Roles > Phone app: bill photo, and whether this person types rates at all
  // (hidden = saved at 0 for the office to fill in).
  const access = useAccess();
  const hideRate = access.hide.purchaseRate;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'info' | 'warning'; text: string } | null>(null);
  const [np, setNp] = useState<NewProduct | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string; suggestedTracking: string }[] | null>(null);
  const [npBusy, setNpBusy] = useState(false);
  /** Bill lines with no product in Atlas yet (G7) - each offers Create product or Search. */
  const [billLines, setBillLines] = useState<{ description: string; qty: string; rate: string; serials: string[] }[]>([]);

  /** A line for a product, with what the bill said about it. */
  const addLineFrom = (p: ProductHit, from: { qty: string; rate: string; serials: string[] }) => {
    setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls : [...ls, {
      key: `${p.id}-${Date.now()}`, product: p, qty: from.qty || '1', rate: hideRate ? '' : from.rate,
      serials: p.trackingMode === 'serial' ? from.serials : [],
    }]);
  };

  const openNewProduct = (init: Partial<NewProduct>) => {
    setNp({ barcode: null, name: '', categoryId: null, trackingMode: 'quantity', sell: '', cost: '', ...init });
    if (!cats) productFormOptions().then((r) => setCats(r?.categories ?? [])).catch(() => setCats([]));
  };

  const saveNewProduct = async () => {
    if (!np) return;
    if (!np.name.trim()) { setMsg({ tone: 'danger', text: t('Give the product a name.') }); return; }
    setNpBusy(true);
    try {
      const r = await createProductFromScan({
        productName: np.name.trim(), barcode: np.barcode, categoryId: np.categoryId, trackingMode: np.trackingMode,
        sell: np.sell, cost: np.cost, taxRatePct: 18,
      });
      if (r?.product) {
        const bl = np.fromBillLine !== undefined ? billLines[np.fromBillLine] : undefined;
        if (bl) {
          addLineFrom(r.product, bl);
          setBillLines((b) => b.filter((_, i) => i !== np.fromBillLine));
        } else addProduct(r.product);
        setMsg({ tone: 'success', text: t(`${r.product.productName} created (${r.product.productCode}) and added below.`) });
        setNp(null);
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not create the product.') });
    } finally {
      setNpBusy(false);
    }
  };

  useEffect(() => {
    if (supplier) return;
    const h = setTimeout(() => { searchSuppliers(supplierQ).then((r) => r && setSuppliers(r.suppliers)).catch(() => undefined); }, 300);
    return () => clearTimeout(h);
  }, [supplierQ, supplier]);

  useEffect(() => {
    if (productQ.trim().length < 2) return;
    const h = setTimeout(() => { searchProducts(productQ).then((r) => r && setProducts(r.products)).catch(() => undefined); }, 300);
    return () => clearTimeout(h);
  }, [productQ]);

  const addProduct = (p: ProductHit) => {
    setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls : [...ls, { key: `${p.id}-${Date.now()}`, product: p, qty: '1', rate: '', serials: [] }]);
    setProductQ(''); setProducts([]);
  };

  const onCode = async (code: string) => {
    if (scanFor === 'product') {
      const r = await lookupCode(code).catch(() => null);
      if (r?.products[0]) addProduct(r.products[0]);
      else if (r?.units[0]) setMsg({ tone: 'warning', text: t(`${code} is the serial of one ${r.units[0].productName} already on file, not a product barcode.`) });
      else {
        // G2: an unknown barcode becomes a product right here.
        setMsg({ tone: 'info', text: isRetailBarcode(code)
          ? t(`${code} reads as a product barcode Atlas has never seen. Create the product below.`)
          : t(`Nothing on file for ${code}. If it is the product's barcode, create the product below.`) });
        openNewProduct({ barcode: code });
      }
      setScanFor(null);
      return;
    }
    // A serial for the line being scanned.
    setLines((ls) => ls.map((l) => l.key !== scanFor || l.serials.includes(code) ? l : {
      ...l, serials: [...l.serials, code], qty: String(Math.max(Number(l.qty) || 0, l.serials.length + 1)),
    }));
  };

  const onBill = async (b64: string) => {
    setMsg({ tone: 'info', text: t('Reading the bill...') });
    try {
      const r = await readPhoto('supplier_invoice', b64);
      if (r?.kind === 'supplier_invoice') {
        if (r.data.invoiceNo) setBillNo(r.data.invoiceNo);
        if (!supplier && r.data.supplierName) setSupplierQ(r.data.supplierName);
        // G7 (12 Oct 2026): matched lines are added on their own; the rest wait below with Create product.
        const billed = r.data.lines.map((x) => ({
          description: x.description,
          qty: x.qty !== null ? String(x.qty) : '1',
          rate: x.unitPrice !== null ? String(x.unitPrice) : '',
          serials: x.serials,
        }));
        const m = await matchBillLines(billed.map((x) => ({ description: x.description }))).catch(() => null);
        const matched = m?.lines.filter((x) => x.product) ?? [];
        for (const x of matched) addLineFrom(x.product!, billed[x.index]!);
        const unmatched = billed.filter((_, i) => !m?.lines[i]?.product);
        setBillLines(unmatched);
        setMsg({ tone: 'success', text: t(`Bill read: ${billed.length} lines, ${matched.length} added below.${unmatched.length ? ` ${unmatched.length} not in Atlas yet - create or search each.` : ''} Check quantities and scan serials.`) });
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not read that photo. Please try again.') });
    }
  };

  const submit = async () => {
    setMsg(null);
    if (!supplier) { setMsg({ tone: 'danger', text: t('Choose the supplier.') }); return; }
    if (!lines.length) { setMsg({ tone: 'danger', text: t('Add at least one item.') }); return; }
    setBusy(true);
    try {
      const r = await receiveGoods({
        partyId: supplier.id, supplierInvoiceNo: billNo || null,
        lines: lines.map((l) => ({
          productId: l.product.id, productName: l.product.productName, productCode: l.product.productCode,
          qty: Number(l.qty) || 0, unitCostPaise: Math.round((Number(l.rate) || 0) * 100), serials: l.serials,
        })),
      });
      if (r) {
        setMsg({ tone: 'success', text: `${t('Received')} - ${r.grnNo}${r.warnings.length ? `. ${r.warnings.join(' ')}` : ''}` });
        setTimeout(() => router.back(), 1500);
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(false);
    }
  };

  const scanning = lines.find((l) => l.key === scanFor);

  return (
    <SubScreen title={t('Receive goods')} footer={<Button icon="check" label={t('Receive')} loading={busy} onPress={submit} />}>
      {can(access, 'stock.scanBill') && <Button variant="secondary" icon="camera" label={t('Photograph the supplier bill')} onPress={() => setPhoto(true)} />}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      <SectionLabel>{t('Supplier')}</SectionLabel>
      {supplier ? (
        <Row icon="briefcase" title={supplier.name} line={supplier.gstin ?? supplier.phone} onPress={() => { setSupplier(null); setSupplierQ(''); }} right={<Icon name="x" size={18} color={c.muted} />} />
      ) : (
        <>
          <Field label={t('Search supplier')} icon="search" value={supplierQ} onChangeText={setSupplierQ} />
          {suppliers.slice(0, 6).map((s) => <Row key={s.id} title={s.name} line={s.gstin ?? s.phone} onPress={() => setSupplier(s)} />)}
        </>
      )}
      <Field label={t('Supplier bill number')} value={billNo} onChangeText={setBillNo} autoCapitalize="characters" />

      {billLines.length > 0 && (
        <>
          <SectionLabel>{t('On the bill, not in Atlas yet')}</SectionLabel>
          {billLines.map((b, i) => (
            <Card key={`${b.description}-${i}`} style={{ gap: space.sm }}>
              <Text weight="semibold">{b.description}</Text>
              <Text variant="micro" color={c.muted}>{t('Qty')} {b.qty}{b.rate ? ` · ₹${b.rate}` : ''}{b.serials.length ? ` · ${b.serials.length} ${t('serials')}` : ''}</Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}><Button variant="secondary" icon="search" label={t('Search')} onPress={() => setProductQ(b.description)} /></View>
                <View style={{ flex: 1 }}><Button icon="plus" label={t('Create product')} onPress={() => openNewProduct({ name: b.description, fromBillLine: i })} /></View>
              </View>
            </Card>
          ))}
        </>
      )}

      <SectionLabel>{t('Items')}</SectionLabel>
      {lines.map((l) => (
        <Card key={l.key} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{l.product.productName}</Text>
              <Text variant="micro" color={c.muted}>{l.product.productCode}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Remove')} hitSlop={10} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              <Icon name="trash" size={20} color={c.danger} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Field label={t('Quantity')} keyboardType="number-pad" value={l.qty} onChangeText={(v) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, qty: v } : x))} /></View>
            {!hideRate && <View style={{ flex: 1 }}><Field label={t('Rate (₹, before tax)')} keyboardType="decimal-pad" value={l.rate} onChangeText={(v) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, rate: v } : x))} /></View>}
          </View>
          {l.product.trackingMode === 'serial' && (
            <>
              <Button variant="secondary" icon="scan" label={t(`Scan serials (${l.serials.length}/${Number(l.qty) || 0})`)} onPress={() => setScanFor(l.key)} />
              {l.serials.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {l.serials.map((s) => (
                    <Pressable key={s} onPress={() => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, serials: x.serials.filter((y) => y !== s) } : x))}>
                      <Pill label={`${s} ×`} tone="brand" />
                    </Pressable>
                  ))}
                </View>
              )}
              {l.serials.length === 0 && <Text variant="micro" color={c.muted}>{t('No serials scanned - they will be recorded as "serials to follow".')}</Text>}
            </>
          )}
        </Card>
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Field label={t('Add product')} icon="search" value={productQ} onChangeText={setProductQ} /></View>
        <Button style={{ width: 56, paddingHorizontal: 0 }} variant="secondary" icon="scan" label="" onPress={() => setScanFor('product')} />
      </View>
      {products.slice(0, 8).map((p) => <Row key={p.id} title={p.productName} line={p.productCode} onPress={() => addProduct(p)} />)}
      {!np && productQ.trim().length >= 2 && (
        <Button variant="secondary" icon="plus" label={t(`New product "${productQ.trim()}"`)} onPress={() => openNewProduct({ name: productQ.trim() })} />
      )}

      {np && (
        <Card style={{ gap: space.sm }}>
          <Text weight="semibold">{t('New product')}</Text>
          {np.barcode && <Text variant="micro" color={c.muted}>{t('Barcode from the scan')}: {np.barcode}</Text>}
          <Field label={t('Name')} value={np.name} onChangeText={(v) => setNp({ ...np, name: v })} />
          {cats && cats.length > 0 && (
            <>
              <Text variant="micro" color={c.muted}>{t('Category')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {cats.slice(0, 12).map((cat) => (
                  <Pressable key={cat.id} accessibilityRole="button" onPress={() => setNp({ ...np, categoryId: cat.id, trackingMode: cat.suggestedTracking })}>
                    <Pill label={cat.name} tone={np.categoryId === cat.id ? 'brand' : 'neutral'} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Text variant="micro" color={c.muted}>{t('How its stock is counted')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {TRACKING_CHOICES.map(([m, label]) => (
              <Pressable key={m} accessibilityRole="button" onPress={() => setNp({ ...np, trackingMode: m })}>
                <Pill label={t(label)} tone={np.trackingMode === m ? 'brand' : 'neutral'} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Field label={t('Selling price ₹ (can wait)')} keyboardType="decimal-pad" value={np.sell} onChangeText={(v) => setNp({ ...np, sell: v })} /></View>
            {!hideRate && <View style={{ flex: 1 }}><Field label={t('Buying price ₹')} keyboardType="decimal-pad" value={np.cost} onChangeText={(v) => setNp({ ...np, cost: v })} /></View>}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button variant="secondary" label={t('Cancel')} onPress={() => setNp(null)} /></View>
            <View style={{ flex: 1 }}><Button icon="check" label={t('Save and add')} loading={npBusy} onPress={() => void saveNewProduct()} /></View>
          </View>
        </Card>
      )}

      <Scanner
        visible={scanFor !== null}
        mode="code"
        continuous={scanFor !== 'product'}
        count={scanning?.serials.length}
        title={scanFor === 'product' ? t('Scan the product barcode') : t(`Serials for ${scanning?.product.productName ?? ''}`)}
        onCode={(v) => void onCode(v)}
        onClose={() => setScanFor(null)}
      />
      <Scanner visible={photo} mode="photo" title={t('Photograph the supplier bill')} onPhoto={(b) => void onBill(b)} onClose={() => setPhoto(false)} />
    </SubScreen>
  );
}
