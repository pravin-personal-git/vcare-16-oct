import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { customerJobAction, type CustomerJob } from '@/lib/jobs';
import { ApiError } from '@/lib/api';
import { space } from '@/theme/tokens';

/**
 * What a customer can do on their job in the app (workflow slice 5) - the
 * same as the portal and the no-login link: approve an estimate, confirm it
 * is fixed (or say it is not), ask for another visit time, rate, reopen.
 */
export function CustomerJobActions({ complaintId, job, onDone }: { complaintId: string; job: CustomerJob; onDone: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [ask, setAsk] = useState<null | 'not_resolved' | 'decline_estimate' | 'ask_slot' | 'reopen'>(null);
  const [text, setText] = useState('');
  const [stars, setStars] = useState(0);
  const [techStars, setTechStars] = useState(0);
  const [comment, setComment] = useState('');
  const has = (a: string) => job.actions.includes(a);
  const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

  const send = async (op: string, body: Record<string, unknown>, ok: string) => {
    setBusy(op); setMsg(null);
    try {
      const r = await customerJobAction(complaintId, { op, ...body });
      if (!r) return;
      setMsg({ tone: 'success', text: t(ok) }); setAsk(null); setText('');
      onDone();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Try again.') });
    } finally { setBusy(null); }
  };

  const askBox = (op: NonNullable<typeof ask>, label: string, button: string, ok: string) => ask === op && (
    <View style={{ gap: space.sm }}>
      <Field label={t(label)} value={text} onChangeText={setText} multiline />
      <Button label={t(button)} loading={busy === op} disabled={!text.trim()}
        onPress={() => void send(op, op === 'ask_slot' ? { preferred: text } : op === 'decline_estimate' ? { note: text } : { reason: text }, ok)} />
      <Button variant="ghost" label={t('Back')} onPress={() => { setAsk(null); setText(''); }} />
    </View>
  );

  if (!job.actions.length && !job.rating && !job.technician) return null;

  return (
    <Card style={{ gap: space.md }}>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {job.technician && (
        <Text variant="small" color={c.inkSoft}>{t('Your technician')}: {job.technician.name}{job.technician.phone ? ` · ${job.technician.phone}` : ''}</Text>
      )}

      {has('approve_estimate') && job.estimate && (
        <View style={{ gap: space.sm }}>
          <Text weight="semibold">{t('Please approve the estimate')}</Text>
          {job.estimate.lines.map((l, i) => (
            <Text key={i} variant="small">{l.description}{l.qty > 1 ? ` × ${l.qty}` : ''} - {rupees(l.qty * l.unitPaise)}</Text>
          ))}
          {job.estimate.totalPaise > job.estimate.lines.reduce((s, l) => s + l.qty * l.unitPaise, 0) && (
            <Text variant="small" color={c.inkSoft}>{t('GST')}: {rupees(job.estimate.totalPaise - job.estimate.lines.reduce((s, l) => s + l.qty * l.unitPaise, 0))}</Text>
          )}
          <Text weight="semibold">{t('Total')}: {rupees(job.estimate.totalPaise)}</Text>
          {!ask && <Button label={t('Approve')} loading={busy === 'approve_estimate'} onPress={() => void send('approve_estimate', {}, 'Approved - the work will go ahead.')} />}
          {!ask && <Button variant="secondary" label={t('Decline')} onPress={() => setAsk('decline_estimate')} />}
          {askBox('decline_estimate', 'Why are you declining?', 'Decline estimate', 'Declined.')}
        </View>
      )}

      {has('confirm') && (
        <View style={{ gap: space.sm }}>
          {job.otp ? (
            <View style={{ alignItems: 'center', gap: 4, padding: space.md, borderRadius: 12, backgroundColor: c.brandSoft }}>
              <Text variant="small">{t('If it is working, give your technician this code:')}</Text>
              <Text style={{ fontSize: 32, letterSpacing: 8, fontWeight: '700', color: c.brand }}>{job.otp}</Text>
              <Text variant="micro" color={c.muted}>{t('Valid for 30 minutes. Only share it once you are happy with the work.')}</Text>
            </View>
          ) : null}
          <Text weight="semibold">{t('Is it working now?')}</Text>
          {!ask && <Button icon="check" label={t('Yes, it is resolved')} loading={busy === 'confirm'} onPress={() => void send('confirm', {}, 'Thank you - please rate the work below.')} />}
          {!ask && <Button variant="secondary" label={t('No, still a problem')} onPress={() => setAsk('not_resolved')} />}
          {askBox('not_resolved', 'What is still wrong?', 'Send', 'Sent - the technician will come back to it.')}
        </View>
      )}

      {has('rate') && (
        <View style={{ gap: space.sm }}>
          <Text weight="semibold">{t('How did we do?')}</Text>
          <Stars label={t('The work')} value={stars} onChange={setStars} />
          {job.technician && <Stars label={`${t('Your technician')}, ${job.technician.name}`} value={techStars} onChange={setTechStars} />}
          <Field label={t('Anything to add? (optional)')} value={comment} onChangeText={setComment} multiline />
          <Button label={t('Send rating')} loading={busy === 'rate'} disabled={!stars} onPress={() => void send('rate', { stars, techStars: techStars || null, comment }, 'Thank you for the rating.')} />
        </View>
      )}
      {job.rating && (
        <Text variant="small" color={c.inkSoft}>
          {t('You rated the work')} {'★'.repeat(job.rating.stars)}{job.rating.techStars ? ` · ${t('the technician')} ${'★'.repeat(job.rating.techStars)}` : ''}
        </Text>
      )}

      {!ask && has('ask_slot') && <Button variant="ghost" icon="calendar" label={t('Ask for another visit time')} onPress={() => setAsk('ask_slot')} />}
      {!ask && has('reopen') && <Button variant="ghost" label={t('The problem came back')} onPress={() => setAsk('reopen')} />}
      {askBox('ask_slot', 'Which day and time suit you?', 'Send request', 'Sent - we will confirm the new time.')}
      {askBox('reopen', 'What went wrong again?', 'Reopen job', 'Reopened - the technician has been told.')}
    </Card>
  );
}

/** One row of 1-5 stars (the work, the technician). */
function Stars({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text variant="small" color={c.inkSoft}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${label} ${n}`} onPress={() => onChange(n)}>
            <Text style={{ fontSize: 30, color: n <= value ? c.warning : c.line }}>★</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
