import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { AuthFrame } from '@/components/AuthFrame';
import { Banner, Button, Card, Text } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { pairPhone, type PairedDevice } from '@/lib/device';
import { font, radius, space } from '@/theme/tokens';

/**
 * Pair this phone to an employee with the code their admin created.
 *
 * The admin decides whose phone it is (on the website, where they know who is
 * who); the phone only proves it holds the code. Codes are 6 characters from
 * an alphabet without look-alikes (no 0/O, no 1/I), last 30 minutes and work
 * once. Pairing a new phone switches the employee's old phone off.
 */
const ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export default function PairPhone() {
  const { c } = useTheme();
  const { t } = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PairedDevice | null>(null);

  const submit = async () => {
    setError(null);
    if (code.length !== 6) { setError(t('Enter the 6-character pairing code.')); return; }
    setBusy(true);
    try {
      setDone(await pairPhone(code));
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t('Pairing failed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthFrame icon="check" title={t('Phone paired')} subtitle={t(`This phone now belongs to ${done.userName}.`)}>
        <Card style={{ gap: space.xs }}>
          <Text variant="small" color={c.inkSoft}>{t('Store')}</Text>
          <Text weight="semibold">{done.storeName}</Text>
        </Card>
        <Banner tone="info">{t('Next, a short phone setup - then sign in with your own username and password.')}</Banner>
        <Button label={t('Continue to phone setup')} icon="arrowRight" onPress={() => router.replace('/business/setup')} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      icon="lock"
      title={t('Pair this phone')}
      subtitle={t('Your admin gives you a 6-character code from Settings → Phones. It works once and lasts 30 minutes.')}
    >
      <View style={{ gap: 6 }}>
        <Text variant="small" weight="medium" color={c.inkSoft}>{t('Pairing code')}</Text>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase().replace(ALPHABET, '').slice(0, 6))}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={6}
          placeholder="ABC234"
          placeholderTextColor={c.muted}
          onSubmitEditing={submit}
          returnKeyType="go"
          accessibilityLabel={t('Pairing code')}
          style={{
            minHeight: 68, borderRadius: radius.lg, borderWidth: 1.5, borderColor: error ? c.danger : c.line,
            backgroundColor: c.surface, color: c.ink, textAlign: 'center',
            fontFamily: font.brand, fontSize: 30, letterSpacing: 10,
          }}
        />
      </View>
      {error && <Banner tone="danger">{error}</Banner>}
      <Button label={t('Pair this phone')} icon="arrowRight" onPress={submit} loading={busy} disabled={code.length !== 6} />
      <Text variant="small" color={c.muted} align="center">
        {t('Pairing a new phone switches off your old one. Only your admin can undo a pairing.')}
      </Text>
    </AuthFrame>
  );
}
