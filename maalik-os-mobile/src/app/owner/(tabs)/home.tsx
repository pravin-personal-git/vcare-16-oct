import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Card, Text } from '@/components/ui';
import { HomeFrame } from '@/components/HomeFrame';
import { UpdateBanner } from '@/components/UpdateBanner';
import { Icon, type IconName } from '@/components/Icon';
import { Empty, Loading, Pill, SectionLabel, fmtDateTime, rupees, useLoad } from '@/components/Kit';
import { ownerSummary, type OwnerSummary } from '@/lib/owner';
import { AssignSheet } from '@/components/AssignSheet';
import { loadSession } from '@/lib/session';
import { takePendingPath } from '@/lib/push';
import { radius, space } from '@/theme/tokens';

/**
 * THE OWNER'S HOME ON THE PHONE (13 Oct 2026, decision 11 option B).
 *
 * Pravin called the owner login on the phone "pathetic": it was the whole
 * website in a WebView, cards cropped, nothing made for a phone. This is the
 * owner's day on one screen, native: what sold, what is owed, jobs (open,
 * late, nobody on them - assign from here), what waits on them, quick
 * actions, and the full website one tap away for everything else.
 *
 * A person given "Full website" who is not the owner (no Settings: edit)
 * goes straight to the website, as before.
 */
export default function OwnerHome() {
  const { c } = useTheme();
  const { t } = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    void loadSession().then((s) => {
      const ok = s?.kind === 'user' && (s.permissions ?? []).includes('settings.edit');
      if (!ok) { router.replace('/owner/web'); return; }
      setAllowed(true);
      // A notification tapped before the app opened: its page, in the website.
      const next = takePendingPath();
      if (next) router.push({ pathname: '/owner/web', params: { next } });
    });
  }, []);

  const load = useCallback(() => ownerSummary(), []);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [assigning, setAssigning] = useState<OwnerSummary['unassigned'][number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!allowed) return null;
  const web = (next?: string) => router.push(next ? { pathname: '/owner/web', params: { next } } : '/owner/web');

  return (
    <HomeFrame kind="user" roleLine={t('Owner')}>
      {() => (
        <>
          <UpdateBanner />
          {error && <Banner tone="danger">{error}</Banner>}
          {notice && <Banner tone="success">{notice}</Banner>}
          {loading && !data ? <Loading /> : data && (
            <>
              <SectionLabel>{t('Today')}</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Kpi icon="trending" label={t('Sales today')} value={rupees(data.salesPaise)} line={`${data.invoiceCount} ${t('invoices')}`} onPress={() => web('/invoices')} />
                <Kpi icon="check" label={t('Collected today')} value={rupees(data.collectedPaise)} line={`${data.receiptCount} ${t('receipts')}`} onPress={() => web('/receipts')} />
                <Kpi icon="clock" label={t('To collect')} value={rupees(data.toCollectPaise)}
                  line={data.overduePaise > 0 ? `${rupees(data.overduePaise)} ${t('overdue')}` : t('Nothing overdue')}
                  tone={data.overduePaise > 0 ? 'danger' : undefined} onPress={() => web('/invoices?status=overdue')} />
                <Kpi icon="check" label={t('Approvals waiting')} value={String(data.approvalsWaiting)} line={t('Approve from here')}
                  tone={data.approvalsWaiting > 0 ? 'warning' : undefined} onPress={() => router.push('/employee/approvals')} />
              </View>

              {(data.shopRequestsNew ?? 0) > 0 && (
                <Pressable accessibilityRole="button" onPress={() => router.push('/sales/shop-requests')}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: c.brand, backgroundColor: c.brandSoft }}>
                    <Icon name="box" size={22} color={c.brand} />
                    <Text weight="semibold" style={{ flex: 1 }} color={c.brand}>{`${data.shopRequestsNew} ${t('new shop requests - nobody has them yet')}`}</Text>
                    <Icon name="arrowRight" size={18} color={c.brand} />
                  </Card>
                </Pressable>
              )}

              <SectionLabel>{t('Jobs')}</SectionLabel>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Stat label={t('Open')} value={data.jobs.open} onPress={() => router.push('/owner/service')} />
                <Stat label={t('Late')} value={data.jobs.late} tone="danger" onPress={() => router.push('/owner/service')} />
                <Stat label={t('Nobody on it')} value={data.jobs.unassigned} tone="warning" onPress={() => router.push('/owner/service')} />
              </View>
              {data.unassigned.length === 0
                ? <Empty icon="wrench" title={t('Every job has someone on it')} />
                : data.unassigned.slice(0, 8).map((j) => (
                  <Card key={j.id} style={{ gap: space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{j.customerName}</Text>
                      {(j.priority === 'urgent' || j.priority === 'high') && <Pill label={t('Urgent')} tone="danger" />}
                    </View>
                    <Text variant="small" color={c.inkSoft} numberOfLines={2}>{j.description}</Text>
                    <Text variant="micro" color={c.muted}>{`${j.complaintNo} · ${fmtDateTime(j.createdAt)}${j.siteLocation ? ` · ${j.siteLocation}` : ''}`}</Text>
                    <Button label={t('Assign')} variant="secondary" icon="user" onPress={() => setAssigning(j)} />
                  </Card>
                ))}

              <SectionLabel>{t('Quick actions')}</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Quick icon="bell" label={t('Reminder')} line={data.remindersToday ? `${data.remindersToday} ${t('today')}` : t('Set one')} onPress={() => router.push('/reminders')} />
                <Quick icon="file" label={t('Invoices')} onPress={() => web('/invoices')} />
                <Quick icon="send" label={t('Record payment')} onPress={() => web('/receipts?pay=1')} />
                <Quick icon="note" label={t('My requests')} onPress={() => router.push('/employee/requests')} />
              </View>
              <Button label={t('Open the full website')} icon="globe" onPress={() => web()} />
            </>
          )}
          <AssignSheet job={assigning ? { kind: 'complaint', id: assigning.id, no: assigning.complaintNo, customerName: assigning.customerName, technicianIds: [] } : null}
            people={data?.technicians ?? []} onClose={() => setAssigning(null)}
            onDone={(m) => { setAssigning(null); setNotice(m); void reload(); }} />
        </>
      )}
    </HomeFrame>
  );
}

function Kpi({ icon, label, value, line, tone, onPress }: { icon: IconName; label: string; value: string; line: string; tone?: 'danger' | 'warning'; onPress: () => void }) {
  const { c } = useTheme();
  const accent = tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : c.brand;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, padding: space.lg, gap: 4, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Icon name={icon} size={16} color={accent} />
        <Text variant="micro" color={c.inkSoft}>{label}</Text>
      </View>
      <Text variant="h3" weight="bold" color={tone ? accent : c.ink}>{value}</Text>
      <Text variant="micro" color={tone ? accent : c.muted}>{line}</Text>
    </Pressable>
  );
}

function Stat({ label, value, tone, onPress }: { label: string; value: number; tone?: 'danger' | 'warning'; onPress: () => void }) {
  const { c } = useTheme();
  const col = value > 0 && tone ? (tone === 'danger' ? c.danger : c.warning) : c.ink;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flex: 1, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface, alignItems: 'center' })}>
      <Text variant="h2" weight="bold" color={col}>{String(value)}</Text>
      <Text variant="micro" color={c.inkSoft} align="center">{label}</Text>
    </Pressable>
  );
}

function Quick({ icon, label, line, onPress }: { icon: IconName; label: string; line?: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, minHeight: 72, padding: space.md, gap: 4, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface, flexDirection: 'row', alignItems: 'center' })}>
      <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={c.brand} />
      </View>
      <View style={{ flex: 1, marginStart: space.sm }}>
        <Text weight="semibold">{label}</Text>
        {line ? <Text variant="micro" color={c.inkSoft}>{line}</Text> : null}
      </View>
    </Pressable>
  );
}
