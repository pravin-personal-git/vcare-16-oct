import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, TextInput, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, Segmented, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import {
  addReminder, alarmChecks, alarmsSupported, myTone, openExact, openFullScreen, previewTone, reminderOp, setMyTone,
  stopPreview, syncAlarms, TONES, type AlarmChecks, type Repeat,
} from '@/lib/reminders';
import { openAutostartSettings, openBatterySettings, readPermissionState, requestNotifications } from '@/lib/permissions';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/**
 * REMINDERS ON THE PHONE (G-40, 13 Oct 2026) - for everyone, the owner too.
 *
 * Add one (for yourself, or - a manager / the owner - for somebody in the
 * team, decision 12), see what is coming, set your alarm sound (decision 13),
 * and check the phone will actually ring: a reminder that cannot ring on a
 * locked phone is the failure this whole feature exists to prevent, so the
 * setup check is on the same screen, green or red.
 */
type Tab = 'mine' | 'add' | 'setup';

export default function Reminders() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('mine');
  const load = useCallback(() => syncAlarms(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 30_000 });
  const [notice, setNotice] = useState<string | null>(null);
  const [checks, setChecks] = useState<AlarmChecks | null>(null);

  const recheck = useCallback(async () => {
    const p = await readPermissionState().catch(() => null);
    setChecks(alarmChecks(p ? p.notifications : true));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the phone's settings; state is set when it resolves
    void recheck();
    // Back from a settings screen: show the new state.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void recheck(); });
    return () => sub.remove();
  }, [recheck]);
  const allGreen = !!checks && checks.notifications && checks.fullScreen && checks.exact && checks.battery;

  return (
    <SubScreen title={t('Reminders')} subtitle={t('Rings full screen, like an alarm clock')} onRefresh={reload}>
      <Segmented value={tab} onChange={setTab} options={[
        { key: 'mine', label: t('Coming up') },
        { key: 'add', label: t('Add') },
        { key: 'setup', label: allGreen ? t('Phone ready') : t('Phone setup') },
      ]} />
      {checks && !allGreen && tab !== 'setup' && (
        <Pressable accessibilityRole="button" onPress={() => setTab('setup')}>
          <Banner tone="warning">{t('This phone may not ring for reminders. Tap to fix.')}</Banner>
        </Pressable>
      )}
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      {tab === 'mine' && (loading && !data ? <Loading /> : <ReminderList data={data} onChanged={(m) => { setNotice(m); void reload(); }} />)}
      {tab === 'add' && data && (
        <AddForm targets={data.targets} onSaved={(m) => { setNotice(m); setTab('mine'); void reload(); }} />
      )}
      {tab === 'setup' && <Setup checks={checks} defaultTone={data?.defaultTone ?? 'bell'} recheck={recheck} />}
    </SubScreen>
  );
}

const REPEAT_LABEL: Record<Repeat, string> = { none: 'Once', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };

function ReminderList({ data, onChanged }: { data: Awaited<ReturnType<typeof syncAlarms>>; onChanged: (m: string) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (id: string, op: 'done' | 'delete' | 'snooze', msg: string, minutes?: number) => {
    setBusy(id); setErr(null);
    try { await reminderOp(id, op, minutes); onChanged(t(msg)); } catch (e) {
      setErr(e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
    } finally { setBusy(null); }
  };
  if (!data) return <Empty icon="bell" title={t('Could not load reminders')} line={t('Pull down to try again.')} />;
  return (
    <>
      {err && <Banner tone="danger">{err}</Banner>}
      {data.reminders.length === 0
        ? <Empty icon="bell" title={t('No reminders')} line={t('Tap Add. It rings full screen at that time, even with the phone locked.')} />
        : data.reminders.map((r) => {
          const at = r.ringAt ?? r.snoozedUntil ?? r.dueAt;
          const late = Date.parse(at) < Date.parse(data.now);
          return (
            <Card key={r.id} style={{ gap: space.xs, borderColor: late ? c.danger : c.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Icon name="bell" size={18} color={late ? c.danger : c.brand} />
                <Text weight="semibold" style={{ flex: 1 }}>{r.title}</Text>
                {r.repeat !== 'none' && <Pill label={t(REPEAT_LABEL[r.repeat])} tone="brand" />}
              </View>
              {r.note ? <Text variant="small" color={c.inkSoft}>{r.note}</Text> : null}
              <Text variant="small" weight="medium" color={late ? c.danger : c.ink}>
                {`${fmtDateTime(at)}${r.snoozedUntil ? ` · ${t('snoozed')}` : ''}${r.byOther ? ` · ${t('set by your manager')}` : ''}`}
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                <View style={{ flex: 1 }}><Button label={t('Done')} icon="check" loading={busy === r.id} onPress={() => void run(r.id, 'done', 'Done.')} /></View>
                {!r.byOther && <View style={{ flex: 1 }}><Button label={t('Delete')} variant="secondary" icon="trash" onPress={() => void run(r.id, 'delete', 'Deleted.')} /></View>}
              </View>
            </Card>
          );
        })}
      {data.forOthers.length > 0 && (
        <>
          <SectionLabel>{t('Set by me for my team')}</SectionLabel>
          {data.forOthers.map((r) => (
            <Card key={r.id} style={{ gap: 2 }}>
              <Text weight="semibold">{r.title}</Text>
              <Text variant="small" color={c.inkSoft}>{`${r.forName} · ${fmtDateTime(r.snoozedUntil ?? r.dueAt)}${r.repeat !== 'none' ? ` · ${t(REPEAT_LABEL[r.repeat])}` : ''}`}</Text>
              <Pressable accessibilityRole="button" onPress={() => void run(r.id, 'delete', 'Deleted.')} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                <Text variant="small" weight="semibold" color={c.danger}>{t('Take it back')}</Text>
              </Pressable>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

/** India time on the phone: the dates offered are the next seven days. */
function days(t: (s: string) => string) {
  const out: { key: string; label: string; date: Date }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push({
      key: String(i), date: d,
      label: i === 0 ? t('Today') : i === 1 ? t('Tomorrow') : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
    });
  }
  return out;
}

function AddForm({ targets, onSaved }: { targets: { id: string; name: string; self: boolean }[]; onSaved: (m: string) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const dayList = useMemo(() => days(t), [t]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState('0');
  // An hour from now, on the next 5 minutes, to start from.
  const [hour, setHour] = useState(() => { const d = new Date(); d.setHours(d.getHours() + 1); return d.getHours(); });
  const [minute, setMinute] = useState(() => Math.ceil(new Date().getMinutes() / 5) * 5 % 60);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [forUser, setForUser] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const when = () => {
    const d = dayList[Number(day)]!.date;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
  };
  const quick = (mins: number) => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + mins);
    const idx = dayList.findIndex((x) => x.date.toDateString() === new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString());
    setDay(String(Math.max(0, idx))); setHour(d.getHours()); setMinute(d.getMinutes());
  };
  const save = async () => {
    const at = when();
    if (!title.trim()) { setErr(t('What should we remind about?')); return; }
    if (at.getTime() < new Date().getTime() - 30_000) { setErr(t('Choose a later time.')); return; }
    setBusy(true); setErr(null);
    try {
      await addReminder({ title: title.trim(), note: note.trim() || null, dueAt: at.toISOString(), repeat, forUserId: forUser || null });
      onSaved(forUser ? t('Reminder set. It will ring on their phone.') : t('Reminder set. It will ring full screen at that time.'));
    } catch (e) {
      setErr(e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
    } finally { setBusy(false); }
  };
  const chip = (on: boolean, label: string, press: () => void, key?: string) => (
    <Pressable key={key ?? label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={press}
      style={{ paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
      <Text variant="small" weight={on ? 'semibold' : 'medium'} color={on ? c.brand : c.inkSoft}>{label}</Text>
    </Pressable>
  );
  const step = (label: string, value: string, dec: () => void, inc: () => void) => (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text variant="micro" color={c.inkSoft}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} -`} onPress={dec} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h3">−</Text>
        </Pressable>
        <Text variant="h2" weight="bold" style={{ minWidth: 48, textAlign: 'center' }}>{value}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} +`} onPress={inc} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h3">+</Text>
        </Pressable>
      </View>
    </View>
  );
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  return (
    <Card style={{ gap: space.md }}>
      {targets.length > 1 && (
        <View style={{ gap: 6 }}>
          <Text variant="small" weight="medium" color={c.inkSoft}>{t('For')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {targets.map((p) => chip(forUser === (p.self ? '' : p.id), p.self ? t('Me') : p.name, () => setForUser(p.self ? '' : p.id), p.id))}
          </View>
        </View>
      )}
      <View style={{ gap: 6 }}>
        <Text variant="small" weight="medium" color={c.inkSoft}>{forUser ? t('Remind them to') : t('Remind me to')}</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder={t('Call Sharma ji about the AMC')} placeholderTextColor={c.muted} maxLength={200}
          style={[typeScale.body, { fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, backgroundColor: c.surface }]} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {chip(false, t('In 10 min'), () => quick(10))}
        {chip(false, t('In 30 min'), () => quick(30))}
        {chip(false, t('In 1 hour'), () => quick(60))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {dayList.map((d) => chip(day === d.key, d.label, () => setDay(d.key), d.key))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
        {step(t('Hour'), String(h12), () => setHour((hour + 23) % 24), () => setHour((hour + 1) % 24))}
        {step(t('Minute'), String(minute).padStart(2, '0'), () => setMinute((minute + 55) % 60), () => setMinute((minute + 5) % 60))}
        <Pressable accessibilityRole="button" onPress={() => setHour((hour + 12) % 24)}
          style={{ height: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Text weight="bold" color={c.brand}>{hour < 12 ? 'AM' : 'PM'}</Text>
        </Pressable>
      </View>
      <Text variant="small" color={c.inkSoft}>{`${t('Rings')}: ${fmtDateTime(when())}`}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {(['none', 'daily', 'weekly', 'monthly'] as Repeat[]).map((r) => chip(repeat === r, t(REPEAT_LABEL[r]), () => setRepeat(r), r))}
      </View>
      <TextInput value={note} onChangeText={setNote} placeholder={t('Note (optional)')} placeholderTextColor={c.muted} maxLength={1000} multiline
        style={[typeScale.body, { fontFamily: font.regular, color: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, backgroundColor: c.surface, minHeight: 60 }]} />
      {err && <Banner tone="danger">{err}</Banner>}
      <Button label={t('Set reminder')} icon="bell" loading={busy} onPress={() => void save()} />
    </Card>
  );
}

function Setup({ checks, defaultTone, recheck }: { checks: AlarmChecks | null; defaultTone: string; recheck: () => Promise<void> }) {
  const { t } = useT();
  const { c } = useTheme();
  const [tone, setTone] = useState<string | null>(() => myTone());
  useEffect(() => () => stopPreview(), []);
  if (!alarmsSupported()) {
    return <Banner tone="warning">{t('This version of Vcare cannot ring reminders as an alarm. Update the app from the banner on the home screen.')}</Banner>;
  }
  const row = (ok: boolean, title: string, line: string, fix: () => void) => (
    <Card key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: ok ? c.line : c.danger }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? c.successSoft : c.dangerSoft }}>
        <Icon name={ok ? 'check' : 'alert'} size={18} color={ok ? c.success : c.danger} />
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="small" color={c.inkSoft}>{line}</Text>
      </View>
      {!ok && <Button label={t('Fix')} variant="secondary" onPress={fix} />}
    </Card>
  );
  const chosen = tone ?? defaultTone;
  return (
    <>
      <SectionLabel>{t('Will this phone ring?')}</SectionLabel>
      {checks ? (
        <>
          {row(checks.notifications, t('Notifications allowed'), t('Without this nothing can ring.'), () => { void requestNotifications().then(recheck); })}
          {row(checks.fullScreen, t('Full-screen alerts allowed'), t('Shows the alarm over the lock screen.'), openFullScreen)}
          {row(checks.exact, t('Alarms at the exact time'), t('Rings at the minute, not some minutes later.'), openExact)}
          {row(checks.battery, t('Battery saver off for Vcare'), t('Choose "Unrestricted" / "Don\'t optimise".'), () => { void openBatterySettings(); })}
        </>
      ) : <Loading />}
      <Card style={{ gap: space.xs }}>
        <Text weight="semibold">{t('Xiaomi, Vivo, Oppo, Realme phones')}</Text>
        <Text variant="small" color={c.inkSoft}>{t('Also allow Vcare to auto-start, or these phones may stop it in the background.')}</Text>
        <Button label={t('Open auto-start')} variant="secondary" onPress={() => { void openAutostartSettings(); }} />
      </Card>

      <SectionLabel>{t('My alarm sound')}</SectionLabel>
      {TONES.map((x) => {
        const on = chosen === x.key;
        return (
          <Pressable key={x.key} accessibilityRole="button" accessibilityState={{ selected: on }}
            onPress={() => { setTone(x.key); setMyTone(x.key); previewTone(x.key); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface }}>
            <Icon name={on ? 'check' : 'play'} size={18} color={on ? c.brand : c.inkSoft} />
            <Text weight={on ? 'semibold' : 'regular'} style={{ flex: 1 }}>{t(x.label)}</Text>
            {x.key === defaultTone && <Pill label={t('Business default')} />}
          </Pressable>
        );
      })}
      {tone && (
        <Pressable accessibilityRole="button" onPress={() => { setTone(null); setMyTone(null); }} style={{ paddingVertical: 6 }}>
          <Text variant="small" weight="semibold" color={c.brand}>{t('Use the business default')}</Text>
        </Pressable>
      )}
      <Text variant="micro" color={c.muted}>{t('Plays on the alarm volume - turn it up in the phone\'s sound settings.')}</Text>
    </>
  );
}
