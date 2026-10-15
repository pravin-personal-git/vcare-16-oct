import { useState } from 'react';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Field } from '@/components/ui';
import { SubScreen } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { createLead, readPhoto } from '@/lib/jobs';
import { currentFix } from '@/lib/attendance';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { can, useAccess } from '@/lib/access';

/**
 * A new lead from the phone. "Scan visiting card" photographs the card and
 * fills the form with AI (same switch and monthly limit as the website);
 * the salesperson checks it before saving. The lead is assigned to them.
 */
export default function NewLead() {
  const { t } = useT();
  const [f, setF] = useState({ firstName: '', lastName: '', businessName: '', mobile: '', email: '', city: '', address: '', requirement: '' });
  const [camera, setCamera] = useState(false);
  const access = useAccess();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'info'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const onPhoto = async (b64: string) => {
    setReading(true); setMsg({ tone: 'info', text: t('Reading the card...') });
    try {
      const r = await readPhoto('visiting_card', b64);
      if (r?.kind === 'visiting_card') {
        const d = r.data;
        const [first, ...last] = (d.personName ?? '').split(' ');
        setF((x) => ({
          ...x,
          firstName: first || x.firstName, lastName: last.join(' ') || x.lastName,
          businessName: d.companyName ?? x.businessName, mobile: d.mobiles[0] ?? x.mobile,
          email: d.email ?? x.email, city: d.city ?? x.city,
          address: [d.address, d.pincode].filter(Boolean).join(' ') || x.address,
        }));
        setMsg({ tone: 'success', text: t('Filled from the card - check it before saving.') });
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not read that photo. Please try again.') });
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setMsg(null);
    if (!f.firstName.trim()) { setMsg({ tone: 'danger', text: t('Name is required.') }); return; }
    if (!/^\d{10}$/.test(f.mobile.replace(/\D/g, '').slice(-10))) { setMsg({ tone: 'danger', text: t('Mobile must be a 10-digit number.') }); return; }
    setBusy(true);
    try {
      const { fix } = await currentFix();
      const r = await createLead({ ...f, latitude: fix?.lat, longitude: fix?.lng });
      // No signal (F-13): kept on the phone and sent later - there is no lead page to open yet.
      if (isQueued(r)) { setMsg({ tone: 'success', text: t(r.message) }); setTimeout(() => router.back(), 1500); return; }
      if (r?.id) router.replace({ pathname: '/employee/lead/[id]', params: { id: r.id } });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubScreen title={t('New lead')} footer={<Button label={t('Save lead')} icon="check" loading={busy} onPress={save} />}>
      {can(access, 'leads.scanCard') && <Button variant="secondary" icon="camera" label={t('Scan visiting card')} loading={reading} onPress={() => setCamera(true)} />}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Field label={t('First name')} value={f.firstName} onChangeText={set('firstName')} />
      <Field label={t('Last name')} value={f.lastName} onChangeText={set('lastName')} />
      <Field label={t('Business name')} value={f.businessName} onChangeText={set('businessName')} />
      <Field label={t('Mobile number')} icon="phone" keyboardType="phone-pad" value={f.mobile} onChangeText={set('mobile')} maxLength={14} />
      <Field label={t('Email')} keyboardType="email-address" autoCapitalize="none" value={f.email} onChangeText={set('email')} />
      <Field label={t('City')} value={f.city} onChangeText={set('city')} />
      <Field label={t('Address')} value={f.address} onChangeText={set('address')} multiline />
      <Field label={t('What do they need?')} value={f.requirement} onChangeText={set('requirement')} multiline />
      <Scanner visible={camera} mode="photo" title={t('Photograph the visiting card')} onPhoto={(b) => void onPhoto(b)} onClose={() => setCamera(false)} />
    </SubScreen>
  );
}
