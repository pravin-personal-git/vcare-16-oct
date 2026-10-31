import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, SectionLabel, Segmented, SubScreen, fmtDate, fmtDateTime, useLoad } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { Icon } from '@/components/Icon';
import { JobMedia, JobStepper } from '@/components/JobMedia';
import { JobPartsCard } from '@/components/JobPartsCard';
import { JobNextStep } from '@/components/JobNextStep';
import { Waiting } from '@/components/OfflineBar';
import { isQueued } from '@/lib/outbox';
import {
  installation, installationPartsAction, installationStep, returnInstallationItem, scanOntoInstallation,
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
 *
 * LAID OUT LIKE A COMPLAINT (31 Oct 2026, phone 1.0.36): status, Call and
 * Navigate, then the next step (Accept ... Working on site ... Work done with
 * what was done ... the customer's code), the items, remarks and history.
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

  /** A complaint's step on the installation (30 Oct 2026) - Accept ... Working on site, Work done, the customer's code. */
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  const stepAct = async (key: string, body: Record<string, unknown>, done?: string) => {
    setStepBusy(key); setProblem(null); setNotice(null);
    try {
      // Work done carries who took it over on site, when given.
      const r = await installationStep(String(id), body.op === 'work_done' ? { ...body, receivedBy: receivedBy.trim() || null } : body);
      if (r && !isQueued(r) && r.onSite && !r.onSite.ok) return r;
      setNotice(isQueued(r) ? t(r.message) : done ? t(done) : null);
      await reload();
      return r && !isQueued(r) ? r : {};
    } catch (e) {
      setProblem(e instanceof Error ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
      return null;
    } finally {
      setStepBusy(null);
    }
  };

  const [note, setNote] = useState('');
  const addNote = async () => {
    if (await stepAct('note', { op: 'note', body: note }, 'Remark saved - the office sees it on the job.')) setNote('');
  };
  // A long challan (193 pieces) needs finding: search and a To scan / Not fitted filter.
  const [itemQ, setItemQ] = useState('');
  const [itemF, setItemF] = useState<'all' | 'scan' | 'unfit'>('all');

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

  const simple = access.layout.preset === 'simple';
  const itemNeedle = itemQ.trim().toLowerCase();
  const shownItems = j.items.filter((i) => (!itemNeedle || `${i.productName} ${i.productCode ?? ''} ${i.serialNo ?? ''}`.toLowerCase().includes(itemNeedle))
    && (itemF === 'all' || (itemF === 'scan' ? i.scannable && !i.scanned : i.fitStatus === 'to_fit')));

  return (
    <SubScreen title={j.customerName} subtitle={j.challanNo} onRefresh={reload}>
      <Waiting target={`installation:${id}`} />

      {/* ---- as a complaint: status, what, where, Call and Navigate ---- */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {j.stage && <Pill label={t(STATUS_LABEL[j.stage] ?? j.stageLabel ?? j.stage)} tone={STATUS_LABEL[j.stage] ? statusTone(j.stage) : 'brand'} />}
          <Pill label={t('Installation')} tone="neutral" />
          {left > 0 && <Pill label={`${left} ${t('to scan')}`} tone="warning" />}
        </View>
        <Text>{`${j.items.reduce((n, i) => n + i.qty, 0)} ${t('items to fit')}${j.note ? ` - ${j.note}` : ''}`}</Text>
        {j.siteAddress ? <Text variant="small" color={c.inkSoft}>{j.siteAddress}</Text> : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {phone ? <Button style={{ flex: 1 }} variant="secondary" icon="phone" label={t('Call')} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
          {(j.siteLat != null && j.siteLng != null) || j.siteAddress ? (
            <Button
              style={{ flex: 1 }} variant="secondary" icon="navigation" label={t('Navigate')}
              onPress={() => void Linking.openURL(j.siteLat != null && j.siteLng != null
                ? `https://www.google.com/maps/dir/?api=1&destination=${j.siteLat},${j.siteLng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.siteAddress ?? '')}`)}
            />
          ) : null}
        </View>
        <Text variant="micro" color={c.muted}>
          {[j.orderNo, fmtDate(j.dispatchedAt), j.team.join(', ')].filter(Boolean).join(' · ')}
        </Text>
        {simple && j.stage && <JobStepper status={j.stage} />}
      </Card>

      {problem && <Banner tone="danger">{problem}</Banner>}
      {notice && <Banner tone="warning">{notice}</Banner>}

      {/* Who takes it over - sent with Work done. */}
      {canEdit && data?.onTeam && j.stage === 'on_site' && (
        <Field label={t('Received by (optional)')} value={receivedBy} onChangeText={setReceivedBy} placeholder={t("The customer's name")} />
      )}
      {canEdit && j.stage && (
        <JobNextStep status={j.stage} state={{ actions: data?.actions ?? [] }} busy={stepBusy} send={stepAct} noOverride />
      )}

      {/* Site photo and voice note (13 Oct 2026) - the simple layout's switches apply. */}
      {canEdit && (access.layout.preset !== 'simple' || access.layout.job.photo || access.layout.job.voice) && (
        <JobMedia docType="installation_challan" docId={j.id}
          photo={access.layout.preset !== 'simple' || access.layout.job.photo}
          voice={access.layout.preset !== 'simple' || access.layout.job.voice} />
      )}

      {/* ---- what goes in --------------------------------------------- */}
      <SectionLabel>{t('To fit')}</SectionLabel>
      {j.items.length > 6 && (
        <>
          <Field label={t('Find an item')} icon="search" value={itemQ} onChangeText={setItemQ} autoCorrect={false} />
          <Segmented value={itemF} onChange={setItemF} options={[
            { key: 'all', label: `${t('All')} ${j.items.length}` },
            { key: 'scan', label: `${t('To scan')} ${left}` },
            { key: 'unfit', label: `${t('Not fitted')} ${j.items.filter((i) => i.fitStatus === 'to_fit').length}` },
          ]} />
        </>
      )}
      {shownItems.map((i) => (
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

      {left > 0 && j.stage === 'on_site' && (
        <Banner tone="warning">
          {left} {t('item(s) still have no number scanned against them. You can still finish, but the office will not know which ones went in.')}
        </Banner>
      )}

      {/* ---- remarks and history, as on a complaint (31 Oct 2026) ------- */}
      {canEdit && data?.onTeam && (
        <>
          <SectionLabel>{t('Update')}</SectionLabel>
          <Field label={t('What was done')} value={note} onChangeText={setNote} multiline placeholder={t('Fitted 4 cameras, wiring left on the first floor...')} />
          <Button variant="secondary" icon="note" label={t('Add note')} loading={stepBusy === 'note'} disabled={!note.trim()} onPress={() => void addNote()} />
        </>
      )}
      {(data?.activities?.length ?? 0) > 0 && <SectionLabel>{t('History')}</SectionLabel>}
      {(data?.activities ?? []).slice(0, 20).map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, backgroundColor: c.brand }} />
          <View style={{ flex: 1 }}>
            <Text variant="small">{a.body ?? a.kind}</Text>
            <Text variant="micro" color={c.muted}>{fmtDateTime(a.createdAt)}{a.createdByName ? ` · ${a.createdByName}` : ''}</Text>
          </View>
        </View>
      ))}

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
