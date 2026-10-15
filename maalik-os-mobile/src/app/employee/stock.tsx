import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SectionLabel, SubScreen, fmtDate, useLoad } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { listGrns, lookupCode, type ProductHit, type UnitHit } from '@/lib/jobs';
import { ApiError } from '@/lib/api';
import { space } from '@/theme/tokens';

/**
 * The store keeper's screen: scan anything to find out what it is (a
 * product code, a barcode, or the serial of a unit we hold and where it is),
 * receive a delivery, and the latest receipts.
 */
export default function Stock() {
  const { t } = useT();
  const { c } = useTheme();
  const { data, error, loading, reload } = useLoad(useCallback(() => listGrns(), []));
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ code: string; products: ProductHit[]; units: UnitHit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const find = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await lookupCode(q.trim());
      if (r) setResult({ code: q.trim(), ...r });
    } catch (e) {
      setMsg(e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubScreen title={t('Stock')} subtitle={t('Scan, look up and receive goods')} onRefresh={reload}>
      {data?.canReceive && <Button icon="box" label={t('Receive goods')} onPress={() => router.push('/employee/receive')} />}
      <Card style={{ gap: space.md }}>
        <Text weight="semibold">{t('What is this?')}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label={t('Code, barcode or serial')} value={code} onChangeText={setCode} autoCapitalize="characters" onSubmitEditing={() => void find(code)} returnKeyType="search" />
          </View>
          <Button style={{ width: 56, paddingHorizontal: 0 }} variant="secondary" icon="scan" label="" onPress={() => setCamera(true)} />
        </View>
        <Button variant="secondary" icon="search" label={t('Look up')} loading={busy} onPress={() => void find(code)} />
        {msg && <Banner tone="danger">{msg}</Banner>}
        {result && (
          result.products.length === 0 && result.units.length === 0 ? (
            <Banner tone="warning">{t(`Nothing in this branch matches ${result.code}.`)}</Banner>
          ) : (
            <View style={{ gap: space.sm }}>
              {result.units.map((u) => (
                <View key={u.id} style={{ gap: 2, paddingVertical: space.xs }}>
                  <Text weight="semibold">{u.productName}</Text>
                  <Text variant="small" color={c.inkSoft}>{t('Serial')} {u.serialNo} · {u.productCode}</Text>
                  <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: 4 }}>
                    <Pill label={t(u.status.replace(/_/g, ' '))} tone={u.status === 'in_stock' ? 'success' : 'brand'} />
                    <Pill label={t(u.condition)} tone="neutral" />
                    {u.holderName ? <Pill label={u.holderName} tone="warning" /> : null}
                  </View>
                  <Text variant="micro" color={c.muted}>{t('Received')} {fmtDate(u.receivedAt)}{u.grnNo ? ` · ${u.grnNo}` : ''}</Text>
                </View>
              ))}
              {result.products.map((p) => (
                <View key={p.id} style={{ gap: 2 }}>
                  <Text weight="semibold">{p.productName}</Text>
                  <Text variant="small" color={c.inkSoft}>{p.productCode}{p.barcode ? ` · ${p.barcode}` : ''} · {t(p.trackingMode)}</Text>
                </View>
              ))}
            </View>
          )
        )}
      </Card>

      <SectionLabel>{t('Recent receipts')}</SectionLabel>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && (data.grns.length === 0 ? <Empty icon="box" title={t('No goods received yet')} /> : data.grns.map((g) => (
        <Row
          key={g.id}
          title={g.supplierName}
          line={`${g.grnNo}${g.supplierInvoiceNo ? ` · ${t('Bill')} ${g.supplierInvoiceNo}` : ''}`}
          meta={`${fmtDate(g.receivedDate)} · ${g.qty} ${t('items')}`}
          right={<Pill label={t(g.status)} tone={g.status === 'posted' ? 'success' : g.status === 'cancelled' ? 'danger' : 'warning'} />}
        />
      )))}
      <Scanner visible={camera} mode="code" title={t('Scan a code or serial')} onCode={(v) => { setCode(v); void find(v); }} onClose={() => setCamera(false)} />
    </SubScreen>
  );
}
