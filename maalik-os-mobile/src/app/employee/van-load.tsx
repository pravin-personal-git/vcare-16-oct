import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { Pill, Row, SectionLabel, SubScreen } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { branchStock, loadMyVan, type Movable } from '@/lib/jobs';
import { ApiError } from '@/lib/api';
import { space } from '@/theme/tokens';

interface Line { item: Movable; qty: number; unitIds: string[] }

/**
 * Load my van (4 Oct 2026): at the store counter, scan what you take and it
 * moves from the branch shelf onto your van. Scanning a serial picks that exact
 * unit; a barcode adds one of the product. The server refuses more than the
 * branch holds, and a camera without its number - the same rules as the
 * website's Van stock screen.
 */
export default function LoadVan() {
  const { t } = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Movable[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'info' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const h = setTimeout(() => {
      branchStock({ q: q.trim() }).then((r) => r && setFound(r.items)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const add = (item: Movable, unitId: string | null = null) => {
    setLines((ls) => {
      const at = ls.findIndex((l) => l.item.productId === item.productId);
      if (at < 0) return [...ls, { item, qty: 1, unitIds: unitId ? [unitId] : [] }];
      const l = ls[at];
      if (unitId && l.unitIds.includes(unitId)) return ls;
      const unitIds = unitId ? [...l.unitIds, unitId] : l.unitIds;
      const qty = Math.min(item.available, unitId ? Math.max(l.qty, unitIds.length) : l.qty + 1);
      return ls.map((x, i) => (i === at ? { ...x, qty, unitIds } : x));
    });
    setQ('');
    setFound([]);
  };

  const onCode = async (code: string) => {
    try {
      const r = await branchStock({ code });
      if (r && r.items.length >= 1) {
        add(r.items[0], r.matchedUnitId);
        setMsg({ tone: 'success', text: `${r.items[0].productName}${r.matchedUnitId ? ` · ${code}` : ''}` });
      } else {
        setMsg({ tone: 'warning', text: t(`Nothing at the branch matches ${code}.`) });
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    }
  };

  const setQty = (productId: string, v: string) =>
    setLines((ls) => ls.map((l) => (l.item.productId === productId
      ? { ...l, qty: Math.max(1, Math.min(l.item.available, Number(v.replace(/\D/g, '')) || 1)) }
      : l)));

  const toggle = (productId: string, unitId: string) =>
    setLines((ls) => ls.map((l) => {
      if (l.item.productId !== productId) return l;
      const unitIds = l.unitIds.includes(unitId) ? l.unitIds.filter((u) => u !== unitId) : [...l.unitIds, unitId];
      return { ...l, unitIds, qty: Math.max(l.qty, unitIds.length) };
    }));

  const submit = async () => {
    setMsg(null);
    if (!lines.length) { setMsg({ tone: 'danger', text: t('Add at least one item.') }); return; }
    setBusy(true);
    try {
      const r = await loadMyVan({
        lines: lines.map((l) => ({ productId: l.item.productId, qty: l.qty, stockUnitIds: l.unitIds.length ? l.unitIds : undefined })),
      });
      if (r) {
        setMsg({ tone: 'success', text: `${t('Loaded into')} ${r.vanName}` });
        setTimeout(() => router.back(), 1200);
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(false);
    }
  };

  const total = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <SubScreen
      title={t('Load my van')}
      subtitle={t('From the branch shelf onto your van')}
      footer={<Button icon="check" label={`${t('Load')}${total ? ` ${total}` : ''}`} loading={busy} disabled={!lines.length} onPress={() => void submit()} />}
    >
      <Button icon="scan" label={t('Scan items')} onPress={() => setScanning(true)} />
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      <Field
        label={t('Or search by name or code')} icon="search" value={q}
        onChangeText={(v) => { setQ(v); if (v.trim().length < 2) setFound([]); }}
      />
      {found.slice(0, 8).map((i) => (
        <Row
          key={i.productId}
          title={i.productName}
          line={i.productCode}
          right={<Pill label={`${i.available} ${t('at branch')}`} tone="neutral" />}
          onPress={() => add(i)}
        />
      ))}

      {lines.length > 0 && <SectionLabel>{t('Going onto your van')}</SectionLabel>}
      {lines.map((l) => {
        const serial = l.item.trackingMode === 'serial' && l.item.units.length > 0;
        const needed = Math.min(l.qty, l.item.units.length);
        return (
          <Card key={l.item.productId} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{l.item.productName}</Text>
                <Text variant="micro" color={c.muted}>{l.item.available} {t('at branch')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Remove')}
                hitSlop={10}
                onPress={() => setLines((ls) => ls.filter((x) => x.item.productId !== l.item.productId))}
              >
                <Icon name="trash" size={20} color={c.danger} />
              </Pressable>
            </View>
            <Field label={t('Quantity')} keyboardType="number-pad" value={String(l.qty)} onChangeText={(v) => setQty(l.item.productId, v)} />
            {serial && (
              <>
                <Text variant="micro" color={l.unitIds.length === needed ? c.success : c.warning}>
                  {`${l.unitIds.length} / ${needed} ${t('numbers picked - scan them, or tap below')}`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {l.item.units.slice(0, 40).map((u) => (
                    <Pressable key={u.id} onPress={() => toggle(l.item.productId, u.id)}>
                      <Pill label={u.serialNo ?? '—'} tone={l.unitIds.includes(u.id) ? 'brand' : 'neutral'} />
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </Card>
        );
      })}

      <Scanner
        visible={scanning}
        mode="code"
        continuous
        count={total}
        title={t('Scan what goes on the van')}
        onCode={(v) => void onCode(v)}
        onClose={() => setScanning(false)}
      />
    </SubScreen>
  );
}
