import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, Segmented, SubScreen, fmtDate, useLoad } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { Icon } from '@/components/Icon';
import { JobMedia } from '@/components/JobMedia';
import { JobPartsCard } from '@/components/JobPartsCard';
import { JobNextStep } from '@/components/JobNextStep';
import { Waiting } from '@/components/OfflineBar';
import { isQueued } from '@/lib/outbox';
import {
  installation, installationPartsAction, installationWorkDone, returnInstallationItem, scanOntoInstallation,
  STATUS_LABEL, statusTone, updateInstallationItem, type InstallationItem,
} from '@/lib/jobs';
import { dialable, useAccess } from '@/lib/access';
import { space } from '@/theme/tokens';

/**
 * What opens when a technician presses a fitting.
 *
 * Pravin asked to see this screen specifically after the archetype: the site
 * with a way to navigate and call, what goes in today, each item scanned as it
 * is fitted, and one button to say the work is done.
 *
 * SCANNING IS PER ITEM, not per job. A fitting runs for hours and a phone loses
 * signal in a basement or a stairwell; sending six cameras in one request means
 * losing all six because the last one failed. Each scan is its own call, and
 * the one that fails is the one you do again.
 *
 * UNUSED GOODS GO BACK FROM HERE (22 Oct 2026, Vcare): ten cameras left on the
 * order's GDN, eight were fitted - "Unused - send back to store" says two are
 * coming back, and the store adds them to stock when it receives them. The
 * Parts card below asks for what is not on the order (cable, clamps) on a
 * material challan, and sends unused material back the same way.
 */
export default function Installation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const access = useAccess();
  const load = useCallback(() => installation(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);

  const [busy, setBusy] = useState(false);
  // Who took it over on site - optional, sent with Work done (27 Oct 2026).
  const [receivedBy, setReceivedBy] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // F-13: a change made with no signal - kept on the phone, sent later.
  const [notice, setNotice] = useState<string | null>(null);
  const queuedOrDone = (r: unknown) => { if (isQueued(r)) setNotice(t(r.message)); };
  const [scanning, setScanning] = useState<InstallationItem | null>(null);
  // The item whose unused goods are being sent back, and how many.
  const [returning, setReturning] = useState<{ id: string; n: string } | null>(null);
  const [partsBusy, setPartsBusy] = useState<string | null>(null);
  const [partsMsg, setPartsMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  const j = data?.installation;
  const canEdit = data?.canEdit ?? false;

  const scan = async (item: InstallationItem, serialNo: string) => {
    setProblem(null);
    setBusy(true);
    try {
      queuedOrDone(await scanOntoInstallation(String(id), item.id, serialNo));
      setScanning(null);
      await reload();
    } catch (e) {
      // Shown, not swallowed. The commonest cause is scanning the box next to
      // the one being fitted, and a technician can only fix that if told.
      setProblem(e instanceof Error ? e.message : t('That could not be scanned.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setProblem(null);
    setBusy(true);
    try {
      queuedOrDone(await installationWorkDone(String(id), receivedBy.trim() || null));
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t('Could not mark it done.'));
    } finally {
      setBusy(false);
    }
  };

  // G2 (11 Oct 2026): the website's stage and item controls, from site. Each
  // change is its own call, like a scan - a lost signal loses one change.
  const run = async (fn: () => Promise<unknown>, fail: string) => {
    setProblem(null);
    setBusy(true);
    try {
      queuedOrDone(await fn());
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : fail);
    } finally {
      setBusy(false);
    }
  };
  const setFit = (item: InstallationItem, fitStatus: string) =>
    run(() => updateInstallationItem(String(id), item.id, { fitStatus }), t('Could not save that.'));
  const setPlacement = (item: InstallationItem, placement: string) => {
    if ((item.placement ?? '') === placement.trim()) return;
    void run(() => updateInstallationItem(String(id), item.id, { placement }), t('Could not save that.'));
  };
  const sendBack = (item: InstallationItem, n: number) =>
    run(async () => {
      const r = await returnInstallationItem(String(id), item.id, n);
      setReturning(null);
      if (!isQueued(r)) setNotice(t('Noted - hand them in at the store; the store adds them back to stock.'));
      return r;
    }, t('Could not send that back.'));

  /** A Parts card step - the installation's own action, queued on the phone with no signal. */
  const partsAct = async (key: string, body: Record<string, unknown>, done?: string) => {
    setPartsBusy(key); setPartsMsg(null);
    try {
      const r = await installationPartsAction(String(id), body);
      setPartsMsg(isQueued(r) ? { tone: 'warning', text: t(r.message) } : done ? { tone: 'success', text: t(done) } : null);
      void reload();
      return r;
    } catch (e) {
      setPartsMsg({ tone: 'danger', text: e instanceof Error ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
      return null;
    } finally {
      setPartsBusy(null);
    }
  };

  /** A complaint's step on the installation (30 Oct 2026) - Accept, On my way, the customer's code. */
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  const stepAct = async (key: string, body: Record<string, unknown>, done?: string) => {
    setStepBusy(key); setProblem(null); setNotice(null);
    try {
      const r = await installationPartsAction(String(id), body);
      setNotice(isQueued(r) ? t(r.message) : done ? t(done) : null);
      await reload();
      return {};
    } catch (e) {
      setProblem(e instanceof Error ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
      return null;
    } finally {
      setStepBusy(null);
    }
  };

  if (loading && !j) return <SubScreen title={t('Installation')}><Loading /></SubScreen>;
  if (!j) {
    return (
      <SubScreen title={t('Installation')}>
        {error ? <Banner tone="danger">{error}</Banner>
          : <Empty icon="wrench" title={t('Not found')} line={t('This job is not yours, or it has been removed.')} />}
      </SubScreen>
    );
  }

  const left = j.items.filter((i) => i.scannable && !i.scanned).length;
  // Goods go back only by the installation's team, once the order's GDN sent them,
  // and not once billed - then the office uses a Sales Return on the invoice.
  const mayReturn = canEdit && data?.onTeam === true && j.dispatched === true && !j.isInvoiced;
  const phone = dialable(access.hide.customerPhone ? null : j.phone, j.phone);

  return (
    <SubScreen
      title={j.challanNo}
      subtitle={j.customerName}
      onRefresh={reload}
      footer={canEdit && (j.status === 'pending' || j.status === 'rejected') && j.stage !== 'received' && j.stage !== 'assigned' && j.stage !== 'cancelled' ? (
        <Button
          label={left > 0 ? `${t('Mark work done')} (${left} ${t('not scanned')})` : t('Mark work done')}
          onPress={finish}
          loading={busy}
        />
      ) : undefined}
    >
      {problem && <Banner tone="danger">{problem}</Banner>}
      {notice && <Banner tone="warning">{notice}</Banner>}
      <Waiting target={`installation:${id}`} />

      {/* ---- the site ------------------------------------------------- */}
      <Card>
        <Text weight="bold">{j.customerName}</Text>
        {j.siteAddress && <Text variant="small" color={c.inkSoft}>{j.siteAddress}</Text>}
        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
          {j.siteAddress && (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.siteAddress ?? '')}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
            >
              <Icon name="mapPin" size={16} color={c.brand} />
              <Text variant="small" weight="semibold" color={c.brand}>{t('Navigate')}</Text>
            </Pressable>
          )}
          {phone && (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(`tel:${phone}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
            >
              <Icon name="phone" size={16} color={c.brand} />
              <Text variant="small" weight="semibold" color={c.brand}>{t('Call site')}</Text>
            </Pressable>
          )}
        </View>
        <Text variant="micro" color={c.muted} style={{ marginTop: space.sm }}>
          {[j.orderNo, fmtDate(j.dispatchedAt), j.team.join(', ')].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      {/* ---- the stage (servers from 11 Oct 2026) ---------------------- */}
      {j.stageLabel && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <Text variant="small" color={c.inkSoft}>{t('Status')}</Text>
            {/* A complaint's words and colours (servers from 30 Oct 2026); an older server's stage as it was. */}
            <Pill label={t(STATUS_LABEL[j.stage ?? ''] ?? j.stageLabel)} tone={STATUS_LABEL[j.stage ?? ''] ? statusTone(j.stage ?? '') : j.stage === 'billed' || j.stage === 'work_done' ? 'success' : 'brand'} />
          </View>
        </Card>
      )}
      {canEdit && j.stage && (
        <JobNextStep status={j.stage} state={{ actions: data?.actions ?? [] }} busy={stepBusy} send={stepAct} />
      )}

      {/* Site photo and voice note (13 Oct 2026) - the simple layout's switches apply. */}
      {canEdit && (access.layout.preset !== 'simple' || access.layout.job.photo || access.layout.job.voice) && (
        <JobMedia docType="installation_challan" docId={j.id}
          photo={access.layout.preset !== 'simple' || access.layout.job.photo}
          voice={access.layout.preset !== 'simple' || access.layout.job.voice} />
      )}

      {/* ---- what goes in --------------------------------------------- */}
      <SectionLabel>{t('To fit today')}</SectionLabel>
      {j.items.map((i) => (
        <Card key={i.id}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{i.productName}</Text>
              <Text variant="micro" color={c.muted}>
                {[i.productCode, `${i.qty}${i.unit ? ` ${i.unit}` : ''}`].filter(Boolean).join(' · ')}
              </Text>
              {i.serialNo && (
                <Text variant="micro" color={c.inkSoft} style={{ marginTop: 2 }}>
                  {t('Scanned')}: {i.serialNo}
                </Text>
              )}
              {/*
                The barcode off the paper slip, where there is one and it has
                not been matched to a unit. Two different facts - what was
                written down, and what is actually linked - and a technician
                standing in front of the box is the only person who can tell
                whether they are the same thing.
              */}
              {!i.serialNo && i.barcode && (
                <Text variant="micro" color={c.muted} style={{ marginTop: 2 }}>
                  {t('On the slip')}: {i.barcode}
                </Text>
              )}
            </View>
            {i.scannable && (
              i.scanned
                ? <Pill label={t('Done')} tone="success" />
                : canEdit
                  ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { setProblem(null); setScanning(i); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
                    >
                      <Icon name="scan" size={18} color={c.brand} />
                      <Text variant="small" weight="semibold" color={c.brand}>{t('Scan')}</Text>
                    </Pressable>
                  )
                  : <Pill label={t('Not scanned')} tone="warning" />
            )}
          </View>
          {/* Where it goes and whether it is in (servers from 11 Oct 2026). */}
          {i.fitStatus !== undefined && (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              {canEdit ? (
                <>
                  <Field
                    label={t('Location on site')}
                    defaultValue={i.placement ?? ''}
                    placeholder={t('e.g. Main gate')}
                    onEndEditing={(e) => setPlacement(i, e.nativeEvent.text)}
                  />
                  <Segmented
                    value={(i.fitStatus === 'tested' ? 'fitted' : i.fitStatus ?? 'to_fit') as 'to_fit' | 'fitted'}
                    options={[
                      { key: 'to_fit', label: t('To fit') },
                      { key: 'fitted', label: t('Fitted') },
                    ]}
                    onChange={(k) => { if (k !== i.fitStatus) void setFit(i, k); }}
                  />
                </>
              ) : (
                <Text variant="micro" color={c.inkSoft}>
                  {[i.placement, i.fitStatus === 'to_fit' ? t('To fit') : t('Fitted')].filter(Boolean).join(' · ')}
                </Text>
              )}
            </View>
          )}
          {/* Unused, back to the store (22 Oct 2026). */}
          {(i.qtyReturned ?? 0) > 0 && (
            <Text variant="small" color={c.inkSoft} style={{ marginTop: space.sm }}>
              {i.qtyReturned} {t('back at the store')} · {i.qty - (i.qtyReturned ?? 0)} {t('stay on site')}
            </Text>
          )}
          {(i.qtyReturnPending ?? 0) > 0 && (
            <Text variant="small" color={c.warning} style={{ marginTop: space.sm }}>
              {t(`${i.qtyReturnPending} to hand in at the store - it adds them back when it receives them`)}
            </Text>
          )}
          {mayReturn && i.productId && i.qty - (i.qtyReturned ?? 0) - (i.qtyReturnPending ?? 0) > 0 && (returning?.id === i.id ? (
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', marginTop: space.sm }}>
              <View style={{ flex: 1 }}>
                <Field label={t('How many unused?')} keyboardType="number-pad" value={returning.n} onChangeText={(n) => setReturning({ id: i.id, n })} />
              </View>
              <Button label={t('Send back')} loading={busy} onPress={() => { void sendBack(i, Number(returning.n)); }} />
            </View>
          ) : (
            <Button variant="ghost" label={t('Unused - send back to store')} onPress={() => setReturning({ id: i.id, n: '1' })} style={{ marginTop: space.sm }} />
          ))}
        </Card>
      ))}

      {/* ---- material not on the order: cable, clamps (22 Oct 2026) ----- */}
      {partsMsg && <Banner tone={partsMsg.tone}>{partsMsg.text}</Banner>}
      {data?.parts && canEdit && data.onTeam && (
        <JobPartsCard parts={data.parts} onSite={data.working === true} busy={partsBusy} send={partsAct} faultyParts={false} />
      )}

      {j.items.length === 0 && (
        <Empty icon="box" title={t('Nothing on this challan')} line={t('The office has not added any lines yet.')} />
      )}

      {/*
        Said plainly rather than blocking the button. A fitting where one camera
        was swapped for a spare off the shelf is normal, and refusing to close
        the job would mean the technician leaves it open and the office chases
        it tomorrow.
      */}
      {canEdit && (j.status === 'pending' || j.status === 'rejected') && (
        <Card>
          <Field label={t('Received by (optional)')} value={receivedBy} onChangeText={setReceivedBy} placeholder={t("The customer's name")} />
          <Text variant="micro" color={c.muted} style={{ marginTop: space.xs }}>{t('Work done marks every item fitted and starts the warranty today.')}</Text>
        </Card>
      )}

      {left > 0 && (
        <Banner tone="warning">
          {left} {t('item(s) still have no number scanned against them. You can still finish, but the office will not know which ones went in.')}
        </Banner>
      )}

      {scanning && (
        <Scanner
          visible
          mode="code"
          title={scanning.productName}
          prompt={t('Point the camera at the number on the box.')}
          onClose={() => setScanning(null)}
          onCode={(code: string) => { void scan(scanning, code); }}
        />
      )}
    </SubScreen>
  );
}
