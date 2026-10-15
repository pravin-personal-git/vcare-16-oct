import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Loading, Pill, SectionLabel, SubScreen, fmtDate, fmtDateTime, useLoad } from '@/components/Kit';
import { leadAction, leadDetail } from '@/lib/jobs';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { can, useAccess } from '@/lib/access';
import { radius, space } from '@/theme/tokens';

const OUTCOMES = ['Interested', 'Call back', 'Not reachable', 'Not interested', 'Quotation asked'];
const NEXT = [{ label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'Next week', days: 7 }];

/**
 * One lead. Call or WhatsApp straight from here, then log how it went and
 * when to follow up - the call itself is also picked up from the call log.
 */
export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => leadDetail(id), [id]);
  const { data, setData, error, loading, reload } = useLoad(load);
  const [channel, setChannel] = useState<'call' | 'whatsapp' | 'meeting' | 'visit'>('call');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const lead = data?.lead;
  const access = useAccess();
  const canLog = can(access, 'leads.log');
  // A hidden number (Settings > Roles > Phone app) arrives as mobileDial - dialled, never shown.
  const digits = lead ? `${lead.editable.mobileCc}${lead.editable.mobile || lead.editable.mobileDial || ''}`.replace(/\D/g, '') : '';

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key); setMsg(null);
    try {
      const r = await leadAction(id, body);
      if (isQueued(r)) setMsg({ tone: 'success', text: t(r.message) });
      else if (r) { setData({ lead: r.lead }); setMsg({ tone: 'success', text: t(done) }); }
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(null);
    }
  };

  const nextIn = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0);
    return d.toISOString();
  };

  return (
    <SubScreen title={lead?.businessName || lead?.displayName || t('Lead')} subtitle={lead?.leadCode} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !lead ? <Loading /> : lead && (
        <>
          <Card style={{ gap: space.md }}>
            <Text weight="semibold">{lead.displayName}</Text>
            <Text variant="small" color={c.inkSoft}>{[lead.mobile, lead.location].filter(Boolean).join(' · ')}</Text>
            {lead.requirement ? <Text>{lead.requirement}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {lead.stageName ? <Pill label={lead.stageName} tone="brand" /> : null}
              {lead.nextActionAt ? <Pill label={`${t('Follow up')} ${fmtDate(lead.nextActionAt)}`} tone="warning" /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button style={{ flex: 1 }} variant="secondary" icon="phone" label={t('Call')} onPress={() => { setChannel('call'); void Linking.openURL(`tel:+${digits}`); }} />
              <Button style={{ flex: 1 }} variant="secondary" icon="message" label="WhatsApp" onPress={() => { setChannel('whatsapp'); void Linking.openURL(`https://wa.me/${digits}`); }} />
            </View>
          </Card>

          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

          {canLog && (<>
          <SectionLabel>{t('Log how it went')}</SectionLabel>
          <Chips value={channel} onChange={(v) => setChannel(v as typeof channel)} options={[
            { key: 'call', label: t('Call') }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'meeting', label: t('Meeting') }, { key: 'visit', label: t('Visit') },
          ]} />
          <Chips value={outcome ?? ''} onChange={(v) => setOutcome(v === outcome ? null : v)} options={OUTCOMES.map((o) => ({ key: o, label: t(o) }))} />
          <Field label={t('Note')} value={note} onChangeText={setNote} multiline placeholder={t('What did they say?')} />
          <Button
            icon="check" label={t('Save')} loading={busy === 'log'}
            onPress={() => void act('log', { op: 'activity', channel, outcome, note }, 'Saved.').then(() => { setNote(''); setOutcome(null); })}
          />

          <SectionLabel>{t('Next follow-up')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {NEXT.map((n) => (
              <Button key={n.days} style={{ flex: 1 }} variant="secondary" label={t(n.label)} loading={busy === `next-${n.days}`}
                onPress={() => void act(`next-${n.days}`, { op: 'next', at: nextIn(n.days) }, 'Follow-up set.')} />
            ))}
          </View>
          </>)}

          <SectionLabel>{t('History')}</SectionLabel>
          {[...lead.activities.map((a) => ({ id: a.id, at: a.occurredAt, text: [a.channel, a.outcome, a.note].filter(Boolean).join(' · '), who: a.author })),
            ...lead.notes.map((n) => ({ id: n.id, at: n.createdAt, text: n.body, who: n.author }))]
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 25).map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, backgroundColor: c.brand }} />
                <View style={{ flex: 1 }}>
                  <Text variant="small">{h.text}</Text>
                  <Text variant="micro" color={c.muted}>{fmtDateTime(h.at)}{h.who ? ` · ${h.who}` : ''}</Text>
                </View>
              </View>
            ))}
        </>
      )}
    </SubScreen>
  );
}

function Chips({ value, options, onChange }: { value: string; options: { key: string; label: string }[]; onChange: (k: string) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}
          >
            <Text variant="small" weight={on ? 'semibold' : 'regular'} color={on ? c.brand : c.ink}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
