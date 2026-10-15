import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { Empty, SectionLabel, SubScreen, fmtDateTime } from '@/components/Kit';
import { useNet } from '@/lib/net';
import { clearRefused, flushOutbox, refreshCounts, refused, waiting, type OutboxItem, type Refused } from '@/lib/outbox';
import { flushJobQueue, type FailedStep, type QueuedStep } from '@/lib/jobQueue';
import { flushUploads, pendingUploads } from '@/lib/uploads';
import { space } from '@/theme/tokens';

/**
 * WAITING TO SEND (F-13, 13 Oct 2026): everything made on this phone that has
 * not reached the office yet - job steps, installation scans, tasks, notes,
 * photos and voice notes, requests, approvals - and anything the office did
 * not accept when it arrived, with the reason (the office wins, decision Q4).
 */
interface Line { label: string; at: string; detail?: string }

const readJson = async <T,>(k: string): Promise<T[]> => { try { return JSON.parse((await AsyncStorage.getItem(k)) ?? '[]') as T[]; } catch { return []; } };

export default function Outbox() {
  const { t } = useT();
  const { c } = useTheme();
  const net = useNet();
  const [lines, setLines] = useState<Line[]>([]);
  const [bad, setBad] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [q, jobs, files, r, jobBad] = await Promise.all([
      waiting(), readJson<QueuedStep>('maalik.jobs.queue.v1'), pendingUploads(), refused(), readJson<FailedStep>('maalik.jobs.failed.v1'),
    ]);
    setLines([
      ...jobs.map((s) => ({ label: s.label, at: s.at, detail: t('Job step') })),
      ...q.map((x: OutboxItem) => ({ label: x.label, at: x.at })),
      ...files.map((f) => ({ label: f.type.startsWith('audio/') ? t('Voice note') : t('Photo'), at: f.at })),
    ].sort((a, b) => a.at.localeCompare(b.at)));
    setBad([
      ...r.map((x: Refused) => ({ label: x.label, at: x.at, detail: x.message })),
      ...jobBad.map((x) => ({ label: x.label, at: x.at, detail: x.message })),
    ]);
    void refreshCounts();
  }, [t]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the phone's queues; state is set when it resolves
  useEffect(() => { void load(); }, [load]);

  const sendNow = async () => {
    setBusy(true);
    try { await flushJobQueue(); await flushOutbox(); await flushUploads(); } finally { setBusy(false); await load(); }
  };
  const clear = async () => {
    await clearRefused();
    await AsyncStorage.setItem('maalik.jobs.failed.v1', '[]').catch(() => undefined);
    await load();
  };

  return (
    <SubScreen title={t('Waiting to send')} subtitle={net.offline ? t('No signal - sent automatically when it is back') : undefined} onRefresh={sendNow}>
      {bad.length > 0 && (
        <>
          <SectionLabel>{t('Not accepted by the office')}</SectionLabel>
          {bad.map((b, i) => (
            <Card key={`b${i}`} style={{ gap: 2, borderColor: c.danger }}>
              <Text weight="semibold">{t(b.label)}</Text>
              <Text variant="small" color={c.danger}>{t(b.detail ?? '')}</Text>
              <Text variant="micro" color={c.muted}>{`${t('Made')} ${fmtDateTime(b.at)}`}</Text>
            </Card>
          ))}
          <Button variant="secondary" label={t('Clear these messages')} onPress={() => void clear()} />
        </>
      )}
      <SectionLabel>{t('Waiting to send')}</SectionLabel>
      {lines.length === 0
        ? <Empty icon="check" title={t('Everything has been sent')} />
        : lines.map((l, i) => (
          <View key={`w${i}`} style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm }}>
            <Text variant="small" color={c.muted} style={{ width: 96 }}>{fmtDateTime(l.at)}</Text>
            <Text variant="small" style={{ flex: 1 }}>{`${t(l.label)}${l.detail ? ` · ${l.detail}` : ''}`}</Text>
          </View>
        ))}
      {lines.length > 0 && <Banner tone="info">{t('These go automatically, in this order, as soon as there is signal.')}</Banner>}
      {lines.length > 0 && <Button label={t('Send now')} icon="send" loading={busy} onPress={() => void sendNow()} />}
    </SubScreen>
  );
}
