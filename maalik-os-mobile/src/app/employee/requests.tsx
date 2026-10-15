import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SectionLabel, SubScreen, fmtDate, useLoad, type PillTone } from '@/components/Kit';
import { Icon, type IconName } from '@/components/Icon';
import { myDesk, raiseRequest, type DeskKind } from '@/lib/jobs';
import { radius, space } from '@/theme/tokens';

const TONE: Record<string, PillTone> = {
  pending: 'warning', approved: 'success', accepted: 'success', paid: 'success', fulfilled: 'success', completed: 'success', rejected: 'danger',
};
const STATUS: Record<string, string> = {
  pending: 'Waiting', approved: 'Approved', accepted: 'Accepted', paid: 'Paid', fulfilled: 'Handed over', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled',
};

const CHOICES: { kind: DeskKind; label: string; icon: IconName }[] = [
  { kind: 'leave', label: 'Leave', icon: 'calendar' },
  { kind: 'half_day', label: 'Half day', icon: 'clock' },
  { kind: 'wfh', label: 'Work from home', icon: 'briefcase' },
  { kind: 'comp_off', label: 'Comp-off', icon: 'refresh' },
  { kind: 'reimbursement', label: 'Reimbursement', icon: 'file' },
  { kind: 'asset_request', label: 'Asset', icon: 'box' },
];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * My requests on the phone (27 Sep 2026, streamline S2) - the same list and
 * form as My Desk on the website: leave, half day, work from home, comp-off,
 * a reimbursement or an asset, and where each one is and who it waits on.
 * Extra leave days, encashment and resignation stay on the website.
 */
export default function Requests() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => myDesk(), []);
  const { data, error: loadError, loading, reload } = useLoad(load);
  const [kind, setKind] = useState<DeskKind | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const start = (k: DeskKind) => {
    setKind(k); setError(null); setDone(null);
    setF({ fromDate: today(), toDate: today(), expenseDate: today(), days: '1', category: 'travel' });
  };
  const set = (k: string) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const send = async () => {
    if (!kind) return;
    const dated = kind === 'leave' || kind === 'wfh' || kind === 'half_day';
    if (dated && (!isDate(f.fromDate ?? '') || (kind !== 'half_day' && !isDate(f.toDate ?? '')))) {
      setError(t('Write the date as YYYY-MM-DD.')); return;
    }
    setBusy(true); setError(null);
    try {
      const r = await raiseRequest({
        kind, leaveTypeId: f.leaveTypeId || null, fromDate: f.fromDate, toDate: f.toDate || f.fromDate,
        days: Number(f.days || 0), amountRupees: Number(f.amount || 0), category: f.category, expenseDate: f.expenseDate,
        assetType: f.assetType, reason: f.reason || null,
      });
      if (!r) return;
      setKind(null); setDone(t(r.message)); await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not send the request.'));
    } finally { setBusy(false); }
  };

  const chip = (selected: boolean) => ({
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1,
    borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.brandSoft : c.surface,
  });
  const types = data?.options.leaveTypes ?? [];

  return (
    <SubScreen title={t('My requests')} subtitle={t('Leave, work from home, claims')} onRefresh={reload}>
      {(error || loadError) && <Banner tone="danger">{error ?? loadError}</Banner>}
      {done && <Banner tone="success">{done}</Banner>}

      {!kind ? (
        <>
          <SectionLabel>{t('Ask for')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {CHOICES.map((ch) => (
              <Pressable key={ch.kind} accessibilityRole="button" onPress={() => start(ch.kind)}
                style={{ width: '48%', flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
                <Icon name={ch.icon} size={20} color={c.brand} />
                <Text weight="medium">{t(ch.label)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <View style={{ gap: space.md }}>
          <SectionLabel>{t(CHOICES.find((x) => x.kind === kind)?.label ?? 'Request')}</SectionLabel>
          {(kind === 'leave' || kind === 'half_day') && types.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text variant="small" weight="medium" color={c.inkSoft}>{t('Leave type')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                {types.map((lt) => (
                  <Pressable key={lt.id} accessibilityRole="button" onPress={() => set('leaveTypeId')(f.leaveTypeId === lt.id ? '' : lt.id)} style={chip(f.leaveTypeId === lt.id)}>
                    <Text variant="small">{lt.name}{lt.balanceDays !== null ? ` · ${lt.balanceDays} ${t('left')}` : ''}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {(kind === 'leave' || kind === 'wfh' || kind === 'half_day') && (
            <>
              <Field label={kind === 'half_day' ? t('Date (YYYY-MM-DD)') : t('From (YYYY-MM-DD)')} value={f.fromDate} onChangeText={set('fromDate')} />
              {kind !== 'half_day' && <Field label={t('To (YYYY-MM-DD)')} value={f.toDate} onChangeText={set('toDate')} />}
            </>
          )}
          {kind === 'comp_off' && (
            <>
              <Text variant="small" color={c.muted}>{t(`You have ${data?.options.compOffAvailable ?? 0} comp-off day(s).`)}</Text>
              <Field label={t('Days to use')} keyboardType="number-pad" value={f.days} onChangeText={set('days')} />
            </>
          )}
          {kind === 'reimbursement' && (
            <>
              <Field label={t('Amount (₹)')} keyboardType="decimal-pad" value={f.amount} onChangeText={set('amount')} />
              <Field label={t('Spent on (YYYY-MM-DD)')} value={f.expenseDate} onChangeText={set('expenseDate')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                {(data?.options.categories ?? ['travel', 'medical', 'food', 'other']).map((cat) => (
                  <Pressable key={cat} accessibilityRole="button" onPress={() => set('category')(cat)} style={chip(f.category === cat)}>
                    <Text variant="small">{t(cat)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {kind === 'asset_request' && (
            <Field label={t('What do you need')} value={f.assetType} onChangeText={set('assetType')} placeholder={t('Laptop, drill machine, SIM…')} />
          )}
          <Field label={kind === 'reimbursement' ? t('What was it for') : t('Reason')} value={f.reason} onChangeText={set('reason')} multiline />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button style={{ flex: 1 }} variant="secondary" label={t('Back')} onPress={() => setKind(null)} />
            <Button style={{ flex: 1 }} icon="send" label={t('Send request')} loading={busy} onPress={send} />
          </View>
        </View>
      )}

      <SectionLabel>{t('What I asked for')}</SectionLabel>
      {loading && !data ? <Loading /> : data && (
        data.requests.length === 0
          ? <Empty icon="send" title={t('Nothing asked for yet')} line={t('Your requests and their decisions appear here.')} />
          : data.requests.map((r) => (
            <Row key={`${r.kind}:${r.id}`} title={t(r.label)} line={r.detail || undefined}
              meta={[
                t(`Sent ${fmtDate(r.createdAt)}`),
                r.status === 'pending' ? (r.waitingOn.length ? t(`Waiting on ${r.waitingOn.join(' or ')}`) : t('Waiting for the office')) : null,
                r.decisionNote ? t(`Note: ${r.decisionNote}`) : null,
              ].filter(Boolean).join(' · ')}
              right={<Pill label={t(STATUS[r.status] ?? r.status)} tone={TONE[r.status] ?? 'neutral'} />} />
          ))
      )}
    </SubScreen>
  );
}
