import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Loading, Pill, SectionLabel, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { complaintAction, complaintDetail, STATUS_LABEL, statusTone } from '@/lib/jobs';
import { JobNextStep, ChangeVisit } from '@/components/JobNextStep';
import { JobPartsCard } from '@/components/JobPartsCard';
import { JobItemsCard } from '@/components/JobItemsCard';
import { JobMedia, JobStepper } from '@/components/JobMedia';
import { ApiError } from '@/lib/api';
import { can, dialable, useAccess } from '@/lib/access';
import { space } from '@/theme/tokens';
import { clearFailedJobSteps, enqueueJobStep, failedJobSteps, flushJobQueue, pendingJobSteps, QUEUEABLE, type FailedStep } from '@/lib/jobQueue';
import { siteGate } from '@shared/lib/job-flow';
import { isNoSignal } from '@/lib/net';
import { metresBetween } from '@shared/lib/shift';

/**
 * One job. Call the customer, navigate to the site, then the next step the
 * job is on (JobNextStep: accept, on my way, working on site with the
 * location check, leaving site, work done), visits with their change trail,
 * notes and history - the same rules as the website (lib/job-flow).
 */
export default function ComplaintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  // Send anything done offline first, so the screen shows where the job really is.
  const load = useCallback(async () => { await flushJobQueue(); return complaintDetail(id); }, [id]);
  const { data, setData, error, loading, reload } = useLoad(load, { everyMs: 5000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  // Steps waiting to send, and ones the server refused when they finally arrived.
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<FailedStep[]>([]);
  useEffect(() => {
    void pendingJobSteps(id).then((q) => setPending(q.length));
    void failedJobSteps(id).then(setFailed);
  }, [id, data]);

  const act = async (key: string, body: Record<string, unknown>, done?: string) => {
    setBusy(key); setMsg(null);
    try {
      const r = await complaintAction(id, body);
      if (!r) return null;
      setData((d) => (d ? { ...d, complaint: r.complaint } : d));
      // The next steps depend on where the job now is - fetch them again.
      void reload();
      if (r.onSite && !r.onSite.ok) return r;
      if (r.checkIn) {
        setMsg(r.checkIn.withinRange
          ? { tone: 'success', text: t('Checked in at the site.') }
          : { tone: 'warning', text: t(`Checked in ${Math.round(r.checkIn.distanceMeters)} m from the site. It is recorded; your manager may ask.`) });
      } else if (done) setMsg({ tone: 'success', text: t(done) });
      return r;
    } catch (e) {
      // No signal: keep field steps on the phone and send them later (workflow slice 8).
      const op = String(body.op ?? '');
      // No signal (F-13 fix: a request that never arrives is an ApiError with status 0, not another kind of error).
      if (isNoSignal(e) && QUEUEABLE.has(op) && cm) {
        if (op === 'on_site' && data?.site?.gate && cm.siteLat !== null && cm.siteLng !== null) {
          // Check the distance on the phone now; the server checks the same reading when it arrives.
          const lat = Number(body.lat), lng = Number(body.lng);
          const gate = siteGate({
            gateOn: true, radiusM: data.site.radiusM, mocked: body.mocked === true,
            accuracyM: typeof body.accuracyM === 'number' ? body.accuracyM : null,
            distanceM: Number.isFinite(lat) && Number.isFinite(lng) ? metresBetween({ lat, lng }, { lat: cm.siteLat, lng: cm.siteLng }) : null,
          });
          if (!gate.ok) { setMsg({ tone: 'warning', text: t(gate.message) }); return null; }
        }
        await enqueueJobStep(id, body, key);
        setPending((await pendingJobSteps(id)).length);
        setMsg({ tone: 'warning', text: t('No signal - saved on the phone. It will be sent automatically when you are back online.') });
        return null;
      }
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const cm = data?.complaint;
  // Settings > Roles > Phone app: which of the job's buttons this person gets.
  const access = useAccess();
  const canEdit = !!data?.canEdit;
  // Settings > Roles > Phone app > Job steps (1.0.5). The older "Start work /
  // mark resolved" switch is for 1.0.4 phones only - it hid every step here
  // on the live test of 28 Sep 2026.
  const canWork = canEdit && can(access, 'complaints.jobSteps');
  const canNote = canEdit && can(access, 'complaints.note');
  const phone = cm ? dialable(cm.customerPhone, cm.customerPhoneDial) : '';
  /**
   * THE SIMPLE LAYOUT (13 Oct 2026, decision 5): customer, area, problem,
   * Call, Navigate, the step and one big next-step button, photo, voice note,
   * parts, item serials. History, calls and earlier visits only when the
   * office switches them on (Settings > Roles > Phone app > Layout). No
   * Decline - the office reassigns (decision 9). Standard: everything, as before.
   */
  const simple = access.layout.preset === 'simple';
  const J = simple ? access.layout.job : { callnav: true, photo: true, voice: true, parts: true, items: true, visits: true, calls: true, history: true };
  const stepState = data && simple ? { ...data, actions: (data.actions ?? []).filter((a) => a !== 'decline') } : data;
  const openVisits = cm?.visits.filter((v) => v.status !== 'completed' && v.status !== 'cancelled') ?? [];

  return (
    <SubScreen title={cm?.customerName ?? t('Complaint')} subtitle={cm?.complaintNo} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !cm ? <Loading /> : cm && (
        <>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Pill label={t(STATUS_LABEL[cm.status] ?? cm.status)} tone={statusTone(cm.status)} />
              {cm.productName ? <Pill label={cm.productName} tone="neutral" /> : null}
            </View>
            <Text>{cm.description}</Text>
            {cm.siteLocation ? <Text variant="small" color={c.inkSoft}>{cm.siteLocation}</Text> : null}
            {J.callnav && <View style={{ flexDirection: 'row', gap: space.sm }}>
              {phone ? <Button style={{ flex: 1 }} variant="secondary" icon="phone" label={t('Call')} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
              {cm.siteLat !== null && cm.siteLng !== null && (
                <Button
                  style={{ flex: 1 }} variant="secondary" icon="navigation" label={t('Navigate')}
                  onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${cm.siteLat},${cm.siteLng}`)}
                />
              )}
            </View>}
            {simple && <JobStepper status={cm.status} />}
          </Card>

          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          {pending > 0 && <Banner tone="warning">{t(`${pending} step(s) saved offline - they will be sent when you are online.`)}</Banner>}
          {failed.map((f, i) => (
            <Banner key={i} tone="danger">{t(`Sent later but not accepted (${f.label}): ${f.message}`)}</Banner>
          ))}
          {failed.length > 0 && <Button variant="ghost" label={t('Clear these messages')} onPress={() => void clearFailedJobSteps(id).then(() => setFailed([]))} />}

          {data?.noStepReason ? <Banner tone="info">{t(data.noStepReason)}</Banner> : null}
          {canWork && stepState && <JobNextStep status={cm.status} state={stepState} busy={busy} send={act} />}
          {canEdit && (J.photo || J.voice) && <JobMedia docType="complaint" docId={id} photo={J.photo} voice={J.voice} />}
          {/* Stage 8: the items - who pays, where they are, and taking them for repair. */}
          {J.items && data?.items && data.items.length > 0 && (
            <JobItemsCard items={data.items} busy={busy} send={act}
              canPickUp={canEdit && can(access, 'complaints.pickup') && data.canPickUp !== false && cm.assignedTechnicianId === data.me && !['closed', 'cancelled', 'resolved', 'awaiting_customer'].includes(cm.status)} />
          )}
          {J.parts && canWork && data?.parts && <JobPartsCard parts={data.parts} onSite={cm.status === 'on_site'} busy={busy} send={act} />}
          {cm.declinedReason && cm.status === 'received' ? <Banner tone="warning">{t(`Declined: ${cm.declinedReason}`)}</Banner> : null}

          {openVisits.length > 0 && <SectionLabel>{t('Visits')}</SectionLabel>}
          {openVisits.map((v) => (
            <Card key={v.id} style={{ gap: space.md }}>
              <Text weight="semibold">{t(v.purpose === 'field_visit' ? 'Field visit' : 'Visit')} · {fmtDateTime(v.scheduledAt)}</Text>
              {v.checkedInAt ? (
                <Text variant="small" color={v.checkInWithinRange ? c.success : c.warning}>
                  {t('Checked in')} {fmtDateTime(v.checkedInAt)}{v.checkInDistanceM !== null ? ` · ${Math.round(v.checkInDistanceM)} m` : ''}
                </Text>
              ) : null}
              {J.visits && (v.changes ?? []).map((ch) => (
                <Text key={ch.id} variant="micro" color={c.muted}>
                  {ch.kind === 'cancel' ? t('Cancelled') : `${t('Moved')} ${fmtDateTime(ch.fromAt)} → ${ch.toAt ? fmtDateTime(ch.toAt) : '-'}`} · {ch.reason}
                </Text>
              ))}
              {canWork && v.status === 'scheduled' && <ChangeVisit visitId={v.id} busy={busy} send={act} />}
            </Card>
          ))}

          {(canNote || canWork) && (
            <>
              <SectionLabel>{t('Update')}</SectionLabel>
              {canNote && <Field label={t('What was done')} value={note} onChangeText={setNote} multiline placeholder={t('Replaced the compressor, tested for 20 minutes...')} />}
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {canNote && <Button
                  style={{ flex: 1 }} variant="secondary" icon="note" label={t('Add note')} loading={busy === 'note'} disabled={!note.trim()}
                  onPress={() => void act('note', { op: 'note', body: note }, 'Note added.').then(() => setNote(''))}
                />}
              </View>
            </>
          )}

          {J.calls && (data?.calls?.length ?? 0) > 0 && (
            <>
              <SectionLabel>{t('Calls with the customer')}</SectionLabel>
              {data!.calls!.slice(0, 10).map((k) => (
                <Text key={k.id} variant="small" color={c.inkSoft}>
                  {k.userName} · {t(k.direction === 'incoming' ? 'customer called' : k.direction === 'outgoing' ? 'called' : k.direction)} · {fmtDateTime(k.startedAt)} · {k.durationSec > 0 ? `${Math.floor(k.durationSec / 60)}m ${k.durationSec % 60}s` : t('not connected')}
                </Text>
              ))}
            </>
          )}

          {J.history && <SectionLabel>{t('History')}</SectionLabel>}
          {J.history && cm.activities.slice(0, 20).map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, backgroundColor: c.brand }} />
              <View style={{ flex: 1 }}>
                <Text variant="small">{a.body ?? (a.statusTo ? `${t('Status')}: ${t(STATUS_LABEL[a.statusTo] ?? a.statusTo)}` : a.kind)}</Text>
                <Text variant="micro" color={c.muted}>{fmtDateTime(a.createdAt)}{a.createdByName ? ` · ${a.createdByName}` : ''}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </SubScreen>
  );
}
