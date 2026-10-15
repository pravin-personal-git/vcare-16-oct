import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Field } from '@/components/ui';
import { SubScreen } from '@/components/Kit';
import { changePassword } from '@/lib/jobs';
import { loadSession, saveSession } from '@/lib/session';
import { ApiError } from '@/lib/api';

/**
 * Change password. On first sign-in with a temporary password from the
 * business (`?first=1`) the current one is not asked again.
 */
export default function Password() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const isFirst = first === '1';
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    if (next.length < 8) { setMsg({ tone: 'danger', text: t('Password must be at least 8 characters.') }); return; }
    if (next !== confirm) { setMsg({ tone: 'danger', text: t('Passwords do not match.') }); return; }
    setBusy(true);
    try {
      const r = await changePassword(current, next);
      if (r) {
        const s = await loadSession();
        if (s) await saveSession({ ...s, mustReset: false });
        setMsg({ tone: 'success', text: t('Password changed.') });
        setTimeout(() => router.replace('/customer/home'), 900);
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubScreen title={isFirst ? t('Set your password') : t('Change password')}>
      {isFirst && <Banner tone="info">{t('You signed in with a temporary password from the business. Choose your own to continue.')}</Banner>}
      {!isFirst && <Field label={t('Current password')} icon="lock" secure value={current} onChangeText={setCurrent} autoCapitalize="none" />}
      <Field label={t('New password')} icon="lock" secure value={next} onChangeText={setNext} autoCapitalize="none" />
      <Field label={t('Confirm new password')} icon="lock" secure value={confirm} onChangeText={setConfirm} autoCapitalize="none" onSubmitEditing={save} />
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Button label={t('Save password')} icon="check" loading={busy} onPress={save} />
    </SubScreen>
  );
}
