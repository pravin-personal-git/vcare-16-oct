import { useCallback, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, SubScreen, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import { customerShop, sendList, setListQty, shopRupees, type ShopList } from '@/lib/shop';
import { radius, space } from '@/theme/tokens';

/**
 * My list: change quantities, then send it for a quote. Sending makes a lead
 * for the sales team (decision 10). A visit goes to the app's own visit
 * screen, which already asks where the site is.
 */
export default function CustomerList() {
  const { c } = useTheme();
  const { t } = useT();
  const { data, error, loading } = useLoad(useCallback(() => customerShop(), []));
  // The loaded list, until an add or a quantity change returns a newer one.
  const [changed, setList] = useState<ShopList | null | undefined>(undefined);
  const list = changed === undefined ? (data?.list ?? null) : changed;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const lines = list?.lines ?? [];

  const qty = async (id: string, n: number) => {
    setFail(null);
    try {
      const r = await setListQty(id, n);
      if (r) setList(r.list);
    } catch (e) {
      setFail(e instanceof ApiError ? e.message : t('Could not change that.'));
    }
  };

  const send = async () => {
    setBusy(true);
    setFail(null);
    try {
      const r = await sendList(message);
      if (!r) { router.replace('/customer/login'); return; }
      setSent(true);
    } catch (e) {
      setFail(e instanceof ApiError ? e.message : t('Could not send that.'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <SubScreen title={t('My list')}>
        <Banner tone="success" title={t('Sent. Thank you.')}>
          {`${t('Sent to')} ${data?.business ?? ''}. ${t('Somebody will ring you with a quotation.')}`}
        </Banner>
        <Button label={t('Back to the shop')} onPress={() => router.replace('/customer/shop')} />
      </SubScreen>
    );
  }

  const step = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? t('One more') : t('One fewer')}
      onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text weight="bold">{label}</Text>
    </Pressable>
  );

  return (
    <SubScreen
      title={t('My list')}
      footer={lines.length > 0 ? (
        <Button label={`${t('Send to')} ${data?.business ?? ''}`} icon="send" loading={busy} onPress={send} />
      ) : undefined}
    >
      {(error || fail) && <Banner tone="danger">{fail ?? error}</Banner>}
      {loading && !data ? <Loading /> : lines.length === 0 ? (
        <>
          <Empty icon="box" title={t('Your list is empty')} line={t('Add things from the shop.')} />
          <Button label={t('Open the shop')} onPress={() => router.replace('/customer/shop')} />
        </>
      ) : (
        <>
          {lines.map((l) => (
            <Card key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
              {l.imageUrl ? (
                <Image source={{ uri: l.imageUrl }} resizeMode="contain" style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.surface }} />
              ) : (
                <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="camera" size={22} color={c.brand} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text variant="small" weight="semibold" numberOfLines={2}>{l.name}</Text>
                <Text variant="micro" color={c.inkSoft}>{`${shopRupees(l.pricePaise)} ${t('each')}`}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {step('−', () => qty(l.id, l.qty - 1))}
                <Text weight="bold" style={{ minWidth: 20, textAlign: 'center' }}>{String(l.qty)}</Text>
                {step('+', () => qty(l.id, l.qty + 1))}
              </View>
            </Card>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
            <Text weight="bold">{t('Goods only')}</Text>
            <Text weight="bold">{shopRupees(list?.goodsPaise ?? 0)}</Text>
          </View>
          <Text variant="micro" color={c.inkSoft}>{t('Not a bill. Fitting, cable and travel are added in the quote.')}</Text>
          <Field
            label={t('Anything they should know? (optional)')}
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder={t('Where it is going, when you need it')}
          />
          <Pressable accessibilityRole="button" onPress={() => router.push('/customer/raise?kind=visit')}>
            <Text variant="small" weight="semibold" color={c.brand}>{t('Need a visit instead? Request a service visit')}</Text>
          </Pressable>
        </>
      )}
    </SubScreen>
  );
}
