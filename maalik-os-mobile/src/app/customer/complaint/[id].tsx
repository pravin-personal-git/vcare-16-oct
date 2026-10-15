import { useCallback } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Card, Text } from '@/components/ui';
import { Loading, Pill, SectionLabel, SubScreen, fmtDate, fmtDateTime, useLoad } from '@/components/Kit';
import { customerComplaint, CUSTOMER_STATUS_LABEL, statusTone } from '@/lib/jobs';
import { space } from '@/theme/tokens';
import { CustomerJobActions } from '@/components/CustomerJobActions';

/** A customer's own complaint: where it is up to, who is coming, and the updates the business shared. */
export default function MyComplaint() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const { data, error, loading, reload } = useLoad(useCallback(() => customerComplaint(id), [id]), { everyMs: 5000 });
  const cm = data?.complaint;

  return (
    <SubScreen title={cm?.complaintNo ?? t('Complaint')} subtitle={cm ? fmtDate(cm.createdAt) : undefined} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !cm ? <Loading /> : cm && (
        <>
          <Card style={{ gap: space.md }}>
            <Pill label={t(data?.job?.statusLabel ?? CUSTOMER_STATUS_LABEL[cm.status] ?? cm.status)} tone={statusTone(cm.status)} />
            {cm.productName ? <Text weight="semibold">{cm.productName}</Text> : null}
            <Text>{cm.description}</Text>
            {cm.assignedTechnicianName ? (
              <Text variant="small" color={c.inkSoft}>{t('Technician')}: {cm.assignedTechnicianName}</Text>
            ) : (
              <Text variant="small" color={c.inkSoft}>{t('A technician will be assigned soon.')}</Text>
            )}
          </Card>
          {data?.job && <CustomerJobActions complaintId={id} job={data.job} onDone={() => void reload()} />}
          {/* Stage 8: where each item is, once something has left the site. */}
          {data?.job?.items && data.job.items.some((i) => i.tone !== 'open') && (
            <>
              <SectionLabel>{t('Your items')}</SectionLabel>
              {data.job.items.map((i, n) => (
                <Card key={n} style={{ gap: 4 }}>
                  <Text weight="semibold">{i.name}{i.serialNo ? ` · ${i.serialNo}` : ''}</Text>
                  <Text variant="small" color={i.tone === 'done' ? c.success : i.tone === 'wait' ? c.warning : c.inkSoft}>{t(i.where)}</Text>
                  {i.doc ? <Text variant="micro" color={c.muted}>{i.doc}</Text> : null}
                </Card>
              ))}
            </>
          )}
          {cm.visits.length > 0 && <SectionLabel>{t('Visits')}</SectionLabel>}
          {cm.visits.map((v) => (
            <Card key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{fmtDateTime(v.scheduledAt)}</Text>
                <Text variant="small" color={c.inkSoft}>{v.completedAt ? `${t('Completed')} ${fmtDate(v.completedAt)}` : t('Scheduled')}</Text>
              </View>
              <Pill label={t(CUSTOMER_STATUS_LABEL[v.status] ?? v.status)} tone={statusTone(v.status)} />
            </Card>
          ))}
          {cm.timeline.length > 0 && <SectionLabel>{t('Updates')}</SectionLabel>}
          {cm.timeline.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, backgroundColor: c.brand }} />
              <View style={{ flex: 1 }}>
                <Text variant="small">{a.body ?? (a.statusTo ? `${t('Status')}: ${t(CUSTOMER_STATUS_LABEL[a.statusTo] ?? a.statusTo)}` : '')}</Text>
                <Text variant="micro" color={c.muted}>{fmtDateTime(a.createdAt)}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </SubScreen>
  );
}
