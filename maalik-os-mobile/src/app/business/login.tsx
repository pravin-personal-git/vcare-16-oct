import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { AuthFrame } from '@/components/AuthFrame';
import { Banner, Button, Field, Text } from '@/components/ui';
import { loadDevice, type PairedDevice } from '@/lib/device';
import { useTheme } from '@/theme/ThemeProvider';
import { ApiError, businessLogin } from '@/lib/api';
import { homeFor } from '@/lib/boot';

/**
 * Business login - one screen for owners and staff. Where each person lands
 * is decided by the server from their roles, the same rules as the website.
 * (Phone pairing for employees is added in week 2 and slots in before this.)
 */
export default function BusinessLogin() {
  const { t } = useT();
  const { c } = useTheme();
  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadDevice().then(setDevice); }, []);

  const submit = async () => {
    setError(null);
    setNeedsPairing(false);
    if (!username.trim() || !password) { setError(t('Enter your username and password.')); return; }
    setBusy(true);
    try {
      const s = await businessLogin(username.trim().toLowerCase(), password, device?.token ?? null);
      router.replace(homeFor(s));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pair_required') setNeedsPairing(true);
      setError(e instanceof ApiError ? t(e.message) : t('Could not sign you in right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      icon="briefcase"
      title={t('Business login')}
      subtitle={t('For business owners and staff.')}
    >
      <Field
        label={t('Username')}
        icon="user"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
      />
      <Field
        label={t('Password')}
        icon="lock"
        secure
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        autoComplete="password"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error && <Banner tone="danger">{error}</Banner>}
      {needsPairing && <Button label={t('Pair this phone')} variant="secondary" icon="arrowRight" onPress={() => router.push('/business/pair')} />}
      <Button label={t('Sign in')} icon="arrowRight" onPress={submit} loading={busy} />
      <View style={{ alignItems: 'center', gap: 4, marginTop: 8 }}>
        {device ? (
          <Text variant="small" color={c.inkSoft} align="center">{t(`This phone is paired to ${device.userName}`)}</Text>
        ) : (
          <>
            <Text variant="small" color={c.inkSoft} align="center">{t('Staff: first time on this phone?')}</Text>
            <Button label={t('Pair this phone')} variant="ghost" onPress={() => router.push('/business/pair')} />
          </>
        )}
      </View>
    </AuthFrame>
  );
}
