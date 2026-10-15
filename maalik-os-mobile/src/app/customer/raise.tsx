import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Field, Text } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { SectionLabel, SubScreen, useLoad } from '@/components/Kit';
import { customerComplaints, raiseComplaint } from '@/lib/jobs';
import { currentFix } from '@/lib/attendance';
import * as Location from 'expo-location';
import { ApiError } from '@/lib/api';
import { radius, space } from '@/theme/tokens';

/**
 * Raise a complaint, or ask for a service visit. The site is located the
 * way the website insists on - "I am at the site" (GPS) or a Google Maps
 * link - so the technician can navigate straight there.
 */
export default function Raise() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const visit = kind === 'visit';
  const { t } = useT();
  const { c } = useTheme();
  const { data } = useLoad(useCallback(() => customerComplaints(), []));
  const [productId, setProductId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [where, setWhere] = useState<'gps' | 'link'>('gps');
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [mapsLink, setMapsLink] = useState('');
  const [siteNote, setSiteNote] = useState('');
  const [busy, setBusy] = useState<'loc' | 'send' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const locate = async () => {
    setBusy('loc'); setMsg(null);
    // Only while using the app - a customer is never tracked.
    await Location.requestForegroundPermissionsAsync().catch(() => undefined);
    const r = await currentFix();
    setBusy(null);
    if (r.fix) setFix({ lat: r.fix.lat, lng: r.fix.lng });
    else setMsg({ tone: 'danger', text: t('Your location could not be read. Turn on location, or paste a Google Maps link instead.') });
  };

  const send = async () => {
    setMsg(null);
    if (!description.trim()) { setMsg({ tone: 'danger', text: t('Tell us what the problem is.') }); return; }
    if (where === 'gps' && !fix) { setMsg({ tone: 'danger', text: t('Share your location first.') }); return; }
    if (where === 'link' && !mapsLink.trim()) { setMsg({ tone: 'danger', text: t('Paste the Google Maps link.') }); return; }
    setBusy('send');
    try {
      const r = await raiseComplaint({
        kind: visit ? 'visit' : 'complaint', productId, description, siteNote,
        ...(where === 'gps' && fix ? { lat: fix.lat, lng: fix.lng } : { mapsLink }),
      });
      if (r) router.replace({ pathname: '/customer/complaint/[id]', params: { id: r.id } });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(null);
    }
  };

  const choice = (on: boolean) => ({
    flex: 1, padding: space.md, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface, gap: 4,
  });

  return (
    <SubScreen
      title={visit ? t('Request a service visit') : t('Raise a complaint')}
      footer={<Button icon="send" label={t('Send')} loading={busy === 'send'} onPress={send} />}
    >
      {(data?.products.length ?? 0) > 0 && (
        <>
          <SectionLabel>{t('Which product?')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {data!.products.map((p) => {
              const on = p.productId === productId;
              return (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={p.productId} onPress={() => setProductId(on ? null : p.productId)}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
                  <Text variant="small" color={on ? c.brand : c.ink}>{p.productName}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <Field
        label={visit ? t('What should the technician do?') : t('What is the problem?')}
        value={description} onChangeText={setDescription} multiline
        placeholder={visit ? t('Yearly service of the AC in the office') : t('The AC is making a noise and not cooling')}
      />

      <SectionLabel>{t('Where is it?')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Pressable style={choice(where === 'gps')} onPress={() => setWhere('gps')}>
          <Icon name="mapPin" size={20} color={c.brand} />
          <Text variant="small" weight="semibold">{t('I am at the site')}</Text>
        </Pressable>
        <Pressable style={choice(where === 'link')} onPress={() => setWhere('link')}>
          <Icon name="globe" size={20} color={c.brand} />
          <Text variant="small" weight="semibold">{t('Google Maps link')}</Text>
        </Pressable>
      </View>
      {where === 'gps' ? (
        fix ? <Banner tone="success">{t('Location captured.')}</Banner>
          : <Button variant="secondary" icon="mapPin" label={t('Use my current location')} loading={busy === 'loc'} onPress={locate} />
      ) : (
        <Field label={t('Paste the Google Maps link')} value={mapsLink} onChangeText={setMapsLink} autoCapitalize="none" placeholder="https://maps.app.goo.gl/..." />
      )}
      <Field label={t('Landmark or directions (optional)')} value={siteNote} onChangeText={setSiteNote} placeholder={t('Gate 3, near the warehouse')} />
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    </SubScreen>
  );
}
