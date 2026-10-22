import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isQueued } from '@/lib/outbox';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { Icon } from '@/components/Icon';
import { complaintAction, installationPartsAction, moveVisit, visit, type VisitCall } from '@/lib/jobs';
import { JobPartsCard } from '@/components/JobPartsCard';
import { ApiError } from '@/lib/api';
import { can, dialable, useAccess } from '@/lib/access';
import { enqueueJobStep, flushJobQueue, QUEUEABLE } from '@/lib/jobQueue';
import { isNoSignal } from '@/lib/net';
import { space } from '@/theme/tokens';

/**
 * One visit: where, when, who was rung, and moving it.
 *
 * THE CALLS ARE THE NEW PART. `CallLog` has synced every phone's call log for
 * weeks, matched the number to a customer, and recorded that a zero-second
 * outgoing call means nobody picked up. None of it was ever shown next to the
 * visit it was about, so "did he ring before driving out there?" took two
 * screens and a guess.
 *
 * Rescheduling always demands a reason and asks whose idea it was, because
 * those are the two questions a manager asks about a moved appointment.
 * `VisitChange` has stored both since it was written; the phone could never
 * write one.
 *
 * A complaint's visit also shows that complaint's Parts card (22 Oct 2026,
 * Vcare): send unused parts back, raise a challan, log a faulty part - the
 * complaint's own actions, so the same checks and the same store queue.
 */
export default function Visit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const access = useAccess();
  // Send parts steps saved offline first, so the card shows where they really are.
  const load = useCallback(async () => { await flushJobQueue(); return visit(String(id)); }, [id]);
  const { data, error, loading, reload } = useLoad(load);
  const [partsBusy, setPartsBusy] = useState<string | null>(null);
  const [partsMsg, setPartsMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState('');
  const [why, setWhy] = useState('');
  const [theirIdea, setTheirIdea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const v = data?.visit;
  const canEdit = data?.canEdit ?? false;
  const complaintId = v?.complaintId ?? null;
  const installId = v?.installationChallanId ?? null;

  /** A Parts card step, sent as the job's own - a complaint's, or an installation's (which queues offline itself). */
  const partsAct = async (key: string, body: Record<string, unknown>, done?: string) => {
    if (!complaintId && !installId) return null;
    setPartsBusy(key); setPartsMsg(null);
    try {
      if (!complaintId && installId) {
        const r = await installationPartsAction(installId, body);
        setPartsMsg(isQueued(r) ? { tone: 'warning', text: t(r.message) } : done ? { tone: 'success', text: t(done) } : null);
        void reload();
        return r;
      }
      const r = await complaintAction(complaintId!, body);
      if (done) setPartsMsg({ tone: 'success', text: t(done) });
      void reload();
      return r;
    } catch (e) {
      // No signal: kept on the phone and sent later, under the complaint (workflow slice 8).
      if (complaintId && isNoSignal(e) && QUEUEABLE.has(String(body.op ?? ''))) {
        await enqueueJobStep(complaintId, body, key);
        setPartsMsg({ tone: 'warning', text: t('No signal - saved on the phone. It will be sent automatically when you are back online.') });
        return null;
      }
      setPartsMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
      return null;
    } finally {
      setPartsBusy(null);
    }
  };

  const submit = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const r = await moveVisit(String(id), new Date(when).toISOString(), why.trim(), theirIdea);
      setNotice(isQueued(r) ? t(r.message) : null);
      setMoving(false);
      setWhen(''); setWhy(''); setTheirIdea(false);
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t('Could not move the visit.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !v) return <SubScreen title={t('Visit')}><Loading /></SubScreen>;
  if (!v) {
    return (
      <SubScreen title={t('Visit')}>
        {error ? <Banner tone="danger">{error}</Banner>
          : <Empty icon="calendar" title={t('Not found')} line={t('This visit is not yours, or it has been removed.')} />}
      </SubScreen>
    );
  }

  const phone = dialable(access.hide.customerPhone ? null : v.phone, v.phone);
  const callLine = (call: VisitCall) => {
    const mins = Math.floor(call.durationSec / 60);
    const secs = call.durationSec % 60;
    const length = call.durationSec > 0
      ? `${mins ? `${mins}m ` : ''}${secs}s`
      : t('no answer');
    return `${fmtDateTime(call.startedAt)} · ${length}`;
  };

  return (
    <SubScreen
      title={fmtDateTime(v.scheduledAt)}
      subtitle={v.customerName}
      onRefresh={reload}
      footer={canEdit && v.status === 'scheduled' && !moving ? (
        <Button label={t('Move this visit')} variant="secondary" onPress={() => setMoving(true)} />
      ) : undefined}
    >
      {problem && <Banner tone="danger">{problem}</Banner>}
      {notice && <Banner tone="warning">{notice}</Banner>}

      {/* ---- where ------------------------------------------------------ */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text weight="bold">{v.customerName}</Text>
            {v.siteName && <Text variant="small">{v.siteName}</Text>}
            {v.siteAddress && <Text variant="small" color={c.inkSoft}>{v.siteAddress}</Text>}
          </View>
          {v.checkedInAt
            ? <Pill label={t('On site')} tone="success" />
            : <Pill label={v.status === 'scheduled' ? t('Booked') : v.status} tone="neutral" />}
        </View>
        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
          {(v.siteLat && v.siteLng) || v.siteAddress ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(v.siteLat && v.siteLng
                ? `https://www.google.com/maps/search/?api=1&query=${v.siteLat},${v.siteLng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.siteAddress ?? '')}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
            >
              <Icon name="mapPin" size={16} color={c.brand} />
              <Text variant="small" weight="semibold" color={c.brand}>{t('Navigate')}</Text>
            </Pressable>
          ) : null}
          {phone && (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(`tel:${phone}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
            >
              <Icon name="phone" size={16} color={c.brand} />
              <Text variant="small" weight="semibold" color={c.brand}>{t('Call now')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            // An installation's visit has no complaint - open its installation instead.
            onPress={() => (v.complaintId
              ? router.push({ pathname: '/employee/complaint/[id]', params: { id: v.complaintId } })
              : v.installationChallanId && router.push({ pathname: '/employee/installation/[id]', params: { id: v.installationChallanId } }))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
          >
            <Icon name="wrench" size={16} color={c.brand} />
            <Text variant="small" weight="semibold" color={c.brand}>{v.complaintNo}</Text>
          </Pressable>
        </View>
        {v.description ? (
          <Text variant="small" color={c.inkSoft} style={{ marginTop: space.sm }}>{v.description}</Text>
        ) : null}
      </Card>

      {/* ---- the complaint's parts --------------------------------------- */}
      {partsMsg && <Banner tone={partsMsg.tone}>{partsMsg.text}</Banner>}
      {data?.parts && canEdit && can(access, 'complaints.jobSteps') && (
        <JobPartsCard parts={data.parts} onSite={data.partsOnSite ?? data.complaintStatus === 'on_site'} busy={partsBusy} send={partsAct} faultyParts={!!complaintId} />
      )}

      {/* ---- the calls -------------------------------------------------- */}
      <SectionLabel>{t('Your calls to this site')}</SectionLabel>
      {v.calls.length === 0 ? (
        <Card>
          <Text variant="small" color={c.muted}>
            {t('No calls recorded in the three days before this visit.')}
          </Text>
        </Card>
      ) : v.calls.map((call) => (
        <Card key={call.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="phone" size={18} color={call.unanswered ? c.warning : c.inkSoft} />
            <View style={{ flex: 1 }}>
              <Text variant="small" weight="semibold">
                {call.direction === 'outgoing' ? t('You called') : t('They called')}
              </Text>
              <Text variant="micro" color={c.muted}>{callLine(call)}</Text>
            </View>
            {/*
              The one thing worth a badge. A call that connected is routine; one
              that rang out is why somebody is standing outside a locked gate.
            */}
            {call.unanswered && <Pill label={t('No answer')} tone="warning" />}
          </View>
        </Card>
      ))}

      {/* ---- moving it -------------------------------------------------- */}
      {moving && (
        <Card>
          <Text weight="semibold">{t('Move this visit')}</Text>
          <Field
            label={t('New date and time')}
            value={when}
            onChangeText={setWhen}
            placeholder="2026-10-05 11:00"
          />
          <Field
            label={t('Why is it moving? The customer sees this.')}
            value={why}
            onChangeText={setWhy}
            placeholder={t('Customer away, part not arrived…')}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: theirIdea }}
            onPress={() => setTheirIdea(!theirIdea)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}
          >
            <Icon name={theirIdea ? 'check' : 'x'} size={18} color={theirIdea ? c.success : c.muted} />
            <Text variant="small">{t('The customer asked for this')}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Button label={t('Cancel')} variant="secondary" onPress={() => setMoving(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t('Move it')}
                onPress={submit}
                loading={busy}
                disabled={!when.trim() || !why.trim()}
              />
            </View>
          </View>
        </Card>
      )}

      {/* ---- what has happened to it before ----------------------------- */}
      {v.changes.length > 0 && (
        <>
          <SectionLabel>{t('History')}</SectionLabel>
          {v.changes.map((ch, n) => (
            <Card key={`${ch.createdAt}-${n}`}>
              <Text variant="small" weight="semibold">
                {ch.kind === 'cancel'
                  ? t('Cancelled')
                  : `${fmtDateTime(ch.fromAt)} → ${ch.toAt ? fmtDateTime(ch.toAt) : '—'}`}
              </Text>
              <Text variant="micro" color={c.muted}>
                {ch.reason}
                {ch.requestedByCustomer ? ` · ${t('customer asked')}` : ''}
              </Text>
            </Card>
          ))}
        </>
      )}
    </SubScreen>
  );
}
