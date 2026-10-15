import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, SubScreen, fmtDate, useLoad } from '@/components/Kit';
import { decideApproval, waitingApprovals, type ApprovalItem } from '@/lib/jobs';
import { radius, space } from '@/theme/tokens';

const rupees = (p: number | null) => (p ? `₹${(p / 100).toLocaleString('en-IN')}` : null);

/**
 * Waiting on me, on the phone (5 Oct 2026). Until now a manager who is not the
 * owner had to open the website to approve a leave, an order or a payment.
 * Same list and the same rules as My Desk on the web: own requests, levels,
 * the owner's override and held actions all behave exactly the same.
 * Rejecting needs a reason - the person who asked sees it.
 */
export default function Approvals() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useCallback(() => waitingApprovals(), []);
  const { data, error: loadError, loading, reload } = useLoad(load);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const key = (i: ApprovalItem) => `${i.type}:${i.entityId}`;
  const decide = async (i: ApprovalItem, decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !note.trim()) { setError(t('Say why it is being rejected.')); return; }
    setBusy(key(i)); setError(null); setDone(null);
    try {
      const r = await decideApproval({ type: i.type, entityId: i.entityId, decision, note: decision === 'rejected' ? note.trim() : null });
      if (!r) return;
      setDone(t(r.message)); setRejecting(null); setNote(''); await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the decision.'));
    } finally { setBusy(null); }
  };

  const items = data?.items ?? [];
  return (
    <SubScreen title={t('Approvals')} subtitle={t('What waits on you')} onRefresh={reload}
      list={{ data: items, key: (i) => key(i), render: (i) => (
          <View key={key(i)} style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, marginBottom: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text weight="bold" style={{ flex: 1 }}>{i.title}</Text>
              <Pill label={t(i.typeLabel)} tone="neutral" />
              {i.raisedByMe && <Pill label={t('You raised this')} tone="warning" />}
            </View>
            <Text variant="small" color={c.inkSoft}>
              {[t(`Raised by ${i.requesterName}`), fmtDate(i.since), i.summary, rupees(i.amountPaise),
                i.levels && i.levels > 1 ? t(`Level ${i.level} of ${i.levels}`) : null].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="small" color={c.muted}>
              {t('Stuck with')} {i.waitingOnNames.length ? i.waitingOnNames.join(` ${t('or')} `) : t('Owner / admins')}
            </Text>
            {rejecting === key(i) && (
              <Field label={t('Reason (they will see it)')} value={note} onChangeText={setNote} multiline />
            )}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {rejecting === key(i) ? (
                <>
                  <Button style={{ flex: 1 }} variant="secondary" label={t('Back')} onPress={() => { setRejecting(null); setNote(''); }} />
                  <Button style={{ flex: 1 }} label={t('Reject')} loading={busy === key(i)} onPress={() => decide(i, 'rejected')} />
                </>
              ) : (
                <>
                  <Button style={{ flex: 1 }} variant="secondary" label={t('Reject')} onPress={() => { setRejecting(key(i)); setNote(''); setError(null); }} />
                  <Button style={{ flex: 1 }} icon="check" label={t('Approve')} loading={busy === key(i)} onPress={() => decide(i, 'approved')} />
                </>
              )}
            </View>
          </View>
        ) }}>
      {(error || loadError) && <Banner tone="danger">{error ?? loadError}</Banner>}
      {done && <Banner tone="success">{done}</Banner>}
      <SectionLabel>{t('Waiting on me')}</SectionLabel>
      {loading && !data ? <Loading /> : items.length === 0
        ? <Empty icon="check" title={t('Nothing waiting on you')} line={t('Requests that need your decision appear here, oldest first.')} />
        : null}
    </SubScreen>
  );
}
