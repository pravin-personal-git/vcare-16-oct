import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { AuthFrame, Tabs } from '@/components/AuthFrame';
import { Banner, Button, Field, Text } from '@/components/ui';
import { ApiError, ChooseBusiness, customerLogin, type BusinessChoice } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { otpAvailable, otpLaunchLabel } from '@/lib/otp';
import { radius, space } from '@/theme/tokens';

/**
 * Customer login: the mobile number and password the business set for them,
 * or - from the OTP launch date - a one-time code to that number. Before the
 * launch date the OTP tab is fully visible but explains when it starts, so
 * nobody is surprised by a missing option and nobody waits for an SMS that
 * will never come.
 */
export default function CustomerLogin() {
  const { c } = useTheme();
  const { t, lang } = useT();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<BusinessChoice[] | null>(null);

  const digits = phone.replace(/\D/g, '').slice(-10);
  const phoneOk = /^[6-9]\d{9}$/.test(digits);
  const otpOpen = otpAvailable();

  const submit = async (partyId?: string) => {
    setError(null);
    if (!phoneOk) { setError(t('Enter your 10-digit mobile number.')); return; }
    if (!password) { setError(t('Enter your password.')); return; }
    setBusy(true);
    try {
      const s = await customerLogin(digits, password, partyId);
      setChoices(null);
      router.replace(s.mustReset ? '/customer/password?first=1' : '/customer/home');
    } catch (e) {
      if (e instanceof ChooseBusiness) { setChoices(e.choices); return; }
      setError(e instanceof ApiError ? t(e.message) : t('Could not sign you in right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      icon="user"
      title={t('Customer login')}
      subtitle={t('Use the mobile number registered with the business.')}
    >
      <Tabs
        value={mode}
        onChange={(m) => { setMode(m); setError(null); }}
        options={[{ key: 'password', label: t('Password') }, { key: 'otp', label: t('Login with OTP') }]}
      />

      <Field
        label={t('Mobile number')}
        icon="phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={14}
        placeholder="98XXXXXXXX"
      />

      {mode === 'password' ? (
        <>
          <Field
            label={t('Password')}
            icon="lock"
            secure
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="password"
            onSubmitEditing={() => submit()}
            returnKeyType="go"
          />
          {error && <Banner tone="danger">{error}</Banner>}
          {choices ? (
            <View style={{ gap: space.sm }}>
              <Text weight="semibold">{t('This number is registered with more than one business. Which one?')}</Text>
              {choices.map((b) => (
                <Pressable
                  key={b.partyId}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => submit(b.partyId)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
                    borderRadius: radius.lg, borderWidth: 1, borderColor: c.line,
                    backgroundColor: pressed ? c.brandSoft : c.surface,
                  })}
                >
                  <Icon name="briefcase" size={22} color={c.brand} />
                  <View style={{ flex: 1 }}>
                    <Text weight="semibold">{b.businessName}</Text>
                    <Text variant="small" color={c.inkSoft}>{b.branchName}</Text>
                  </View>
                  <Icon name="arrowRight" size={18} color={c.muted} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Button label={t('Sign in')} icon="arrowRight" onPress={() => submit()} loading={busy} />
          )}
          <View style={{ gap: space.xs }}>
            <Text variant="small" color={c.inkSoft} align="center">{t('Forgot your password?')}</Text>
            <Text variant="small" color={c.muted} align="center">
              {otpOpen
                ? t('Use "Login with OTP", then set a new password.')
                : t('Ask the business to reset it for you, or use "Login with OTP" once it starts.')}
            </Text>
          </View>
        </>
      ) : (
        <>
          {!otpOpen && (
            <Banner tone="warning" title={t('Coming soon')}>
              {`${t(`Login with OTP starts on ${otpLaunchLabel(lang)}.`)} ${t('Until then, sign in with your password.')}`}
            </Banner>
          )}
          <Button label={t('Send code')} icon="message" onPress={() => undefined} disabled={!otpOpen} />
          {!otpOpen && (
            <Button label={t('Use password instead')} variant="ghost" onPress={() => setMode('password')} />
          )}
        </>
      )}
    </AuthFrame>
  );
}
