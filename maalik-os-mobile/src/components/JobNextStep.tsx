import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { currentFix } from '@/lib/attendance';
import type { JobAction, JobState, OnSiteResult } from '@/lib/jobs';
import { space } from '@/theme/tokens';

/**
 * The technician's next step on a job (workflow slice 3, spec §10): one clear
 * set of buttons for where the job is - Accept/Decline, On my way, Working on
 * site (location-checked, with "Ask for override" when it fails), Leaving
 * site, Work done, Book a visit. The server decides which apply (JobState).
 */
type Send = (key: string, body: Record<string, unknown>, done?: string) => Promise<{ onSite?: OnSiteResult } | null>;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const hms = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.max(1, Math.round(sec / 60))} min`);

export function JobNextStep({ status, state, busy, send }: { status: string; state: JobState; busy: string | null; send: Send }) {
  const { t } = useT();
  const { c } = useTheme();
  const actions = state.actions ?? [];
  const [ask, setAsk] = useState<null | 'decline' | 'leave_site' | 'work_done' | 'book_visit' | 'override' | 'fallback'>(null);
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('10:00');
  const [blocked, setBlocked] = useState<OnSiteResult | null>(null);
  const [lastFix, setLastFix] = useState<{ lat: number; lng: number; accuracyM: number | null; mocked: boolean } | null>(null);
  // A ticking clock for 'On site for …' (read in an effect, not while drawing).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  const has = (a: JobAction) => actions.includes(a);
  const reset = () => { setAsk(null); setText(''); };

  const onSite = async () => {
    const { fix, mocked } = await currentFix();
    if (!fix) { setBlocked({ ok: false, message: t('Your location could not be read. Turn on location and try again.') }); return; }
    const reading = { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, mocked };
    setLastFix(reading);
    const r = await send('on_site', { op: 'on_site', ...reading }, 'You are on site - the customer can see work has started.');
    setBlocked(r?.onSite && !r.onSite.ok ? r.onSite : null);
  };

  const info = (() => {
    if (state.overridePending) return t('Waiting for your manager to approve starting work here.');
    if (status === 'awaiting_customer') return t('Ask the customer for the 6-digit code they received (app, link or email) and type it below.');
    if (status === 'resolved') return t('Done - waiting for the office to close the job.');
    if (status === 'closed' || status === 'cancelled') return null;
    return null;
  })();

  if (!actions.length && !info) return null;

  return (
    <Card style={{ gap: space.md }}>
      <Text weight="semibold">{t('Next step')}</Text>
      {info && <Banner tone="info">{info}</Banner>}
      {status === 'on_site' && state.onSiteSince && now > 0 && (
        <Text variant="small" color={c.inkSoft}>{t(`On site for ${hms(Math.max(0, now - Date.parse(state.onSiteSince)) / 1000 + (state.timeOnSiteSec ?? 0))}`)}</Text>
      )}
      {blocked && (
        <Banner tone="warning">{blocked.message ?? t('You cannot start work here yet.')}</Banner>
      )}

      {!ask && (
        <View style={{ gap: space.sm }}>
          {has('accept') && <Button icon="check" label={t('Accept job')} loading={busy === 'accept'} onPress={() => void send('accept', { op: 'accept' }, 'Accepted - the customer can see you are assigned.')} />}
          {has('decline') && <Button variant="secondary" icon="x" label={t('Decline')} onPress={() => setAsk('decline')} />}
          {has('on_the_way') && <Button variant="secondary" icon="navigation" label={t('On my way')} loading={busy === 'on_the_way'} onPress={() => void send('on_the_way', { op: 'on_the_way' }, 'The customer can see you are on the way.')} />}
          {has('on_site') && !state.overridePending && <Button icon="mapPin" label={t('Working on site')} loading={busy === 'on_site'} onPress={() => void onSite()} />}
          {has('on_site') && blocked && blocked.reason !== 'mocked' && !state.overridePending && (
            <Button variant="secondary" icon="alert" label={t('Ask manager for an override')} onPress={() => setAsk('override')} />
          )}
          {has('work_done') && <Button icon="check" label={t('Work done')} onPress={() => setAsk('work_done')} />}
          {has('leave_site') && <Button variant="secondary" icon="arrowLeft" label={t('Leaving site')} onPress={() => setAsk('leave_site')} />}
          {has('book_visit') && <Button variant="ghost" icon="calendar" label={t('Book a visit')} onPress={() => setAsk('book_visit')} />}
          {has('enter_otp') && (
            <View style={{ gap: space.sm }}>
              <Field label={t("Customer's code")} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
              <Button icon="check" label={t('Confirm with code')} loading={busy === 'enter_otp'} disabled={code.replace(/\D/g, '').length !== 6}
                onPress={() => void send('enter_otp', { op: 'enter_otp', code }, 'Confirmed - the job is resolved.').then(() => setCode(''))} />
            </View>
          )}
          {has('resend_otp') && <Button variant="ghost" icon="refresh" label={t('Send the customer a new code')} loading={busy === 'resend_otp'} onPress={() => void send('resend_otp', { op: 'resend_otp' }, 'A new code has been sent to the customer.')} />}
          {has('customer_approved') && <Button variant="ghost" label={t('Customer approved, but has no code')} onPress={() => setAsk('fallback')} />}
        </View>
      )}
      {ask === 'fallback' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('What did the customer say? (the office will call them)')} value={text} onChangeText={setText} multiline />
          <Button label={t('Customer approved, please close')} loading={busy === 'customer_approved'} disabled={!text.trim()}
            onPress={() => void send('customer_approved', { op: 'customer_approved', note: text }, 'Sent - the office will confirm with the customer.').then(reset)} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}

      {ask === 'decline' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('Why can you not take this job?')} value={text} onChangeText={setText} multiline />
          <Button variant="secondary" label={t('Decline job')} loading={busy === 'decline'} disabled={!text.trim()}
            onPress={() => void send('decline', { op: 'decline', reason: text }, 'Declined - the office will reassign it.').then(reset)} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}
      {ask === 'override' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('Why does the location check not work here?')} value={text} onChangeText={setText} multiline placeholder={t('Basement, no GPS signal…')} />
          <Button label={t('Send to manager')} loading={busy === 'override'} disabled={!text.trim()}
            onPress={() => void send('override', { op: 'request_override', reason: text, ...(lastFix ?? {}) }, 'Sent - you will be notified when your manager decides.').then(() => { reset(); setBlocked(null); })} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}
      {ask === 'leave_site' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('Why are you leaving the site?')} value={text} onChangeText={setText} multiline placeholder={t('Fetching a part from the store…')} />
          <Button variant="secondary" label={t('Leave site')} loading={busy === 'leave_site'} disabled={!text.trim()}
            onPress={() => void send('leave_site', { op: 'leave_site', reason: text }, 'Left the site - tap Working on site when you are back.').then(reset)} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}
      {ask === 'work_done' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('What was done')} value={text} onChangeText={setText} multiline placeholder={t('Replaced the driver, tested for 20 minutes…')} />
          <Button label={t('Confirm work done')} loading={busy === 'work_done'}
            onPress={() => void send('work_done', { op: 'work_done', note: text }, 'Marked done - the customer will be asked to confirm.').then(reset)} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}
      {ask === 'book_visit' && (
        <View style={{ gap: space.sm }}>
          <Field label={t('Date (YYYY-MM-DD)')} value={date} onChangeText={setDate} />
          <Field label={t('Time (HH:MM, 24 hour)')} value={time} onChangeText={setTime} />
          <Button icon="calendar" label={t('Book visit')} loading={busy === 'book_visit'}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)}
            onPress={() => void send('book_visit', { op: 'book_visit', at: `${date}T${time.padStart(5, '0')}:00+05:30` }, 'Visit booked - the customer can see the time.').then(reset)} />
          <Button variant="ghost" label={t('Back')} onPress={reset} />
        </View>
      )}
    </Card>
  );
}

/** Move a booked visit - the reason is shown to the customer. */
export function ChangeVisit({ visitId, busy, send }: { visitId: string; busy: string | null; send: Send }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('10:00');
  const [reason, setReason] = useState('');
  if (!open) return <Button variant="ghost" icon="calendar" label={t('Change time')} onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: space.sm }}>
      <Field label={t('New date (YYYY-MM-DD)')} value={date} onChangeText={setDate} />
      <Field label={t('New time (HH:MM, 24 hour)')} value={time} onChangeText={setTime} />
      <Field label={t('Reason (the customer sees it)')} value={reason} onChangeText={setReason} multiline />
      <Button label={t('Move visit')} loading={busy === `change-${visitId}`}
        disabled={!reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)}
        onPress={() => void send(`change-${visitId}`, { op: 'change_visit', visitId, at: `${date}T${time.padStart(5, '0')}:00+05:30`, reason }, 'Visit moved - the customer has been told.').then(() => setOpen(false))} />
      <Button variant="ghost" label={t('Back')} onPress={() => setOpen(false)} />
    </View>
  );
}
