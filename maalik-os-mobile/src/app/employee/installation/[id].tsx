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
import { Waiting } from '@/components/OfflineBar';
import { isQueued } from '@/lib/outbox';
import {
  installation, installationWorkDone, moveInstallationStage, scanOntoInstallation, updateInstallationItem,
  type InstallationItem,
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
 */
export default function Installation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { c } = useTheme();
  const access = useAccess();
  const load = useCallback(() => installation(String(id)), [id]);
  const { data, error, loading, reload } = useLoad(load);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // F-13: a change made with no signal - kept on the phone, sent later.
  const [notice, setNotice] = useState<string | null>(null);
  const queuedOrDone = (r: unknown) => { if (isQueued(r)) setNotice(t(r.message)); };
  const [scanning, setScanning] = useState<InstallationItem | null>(null);

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
      queuedOrDone(await installationWorkDone(String(id)));
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
  const moveStage = (to: string) => run(() => moveInstallationStage(String(id), to), t('Could not move the stage.'));
  const setFit = (item: InstallationItem, fitStatus: string) =>
    run(() => updateInstallationItem(String(id), item.id, { fitStatus }), t('Could not save that.'));
  const setPlacement = (item: InstallationItem, placement: string) => {
    if ((item.placement ?? '') === placement.trim()) return;
    void run(() => updateInstallationItem(String(id), item.id, { placement }), t('Could not save that.'));
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
  const phone = dialable(access.hide.customerPhone ? null : j.phone, j.phone);

  return (
    <SubScreen
      title={j.challanNo}
      subtitle={j.customerName}
      onRefresh={reload}
      footer={canEdit && j.status === 'pending' ? (
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
            <Text variant="small" color={c.inkSoft}>{t('Stage')}</Text>
            <Pill label={t(j.stageLabel)} tone={j.stage === 'approved' ? 'success' : 'brand'} />
            {j.stages && (
              <Text variant="micro" color={c.muted}>
                {j.stages.findIndex((x) => x.key === j.stage) + 1} / {j.stages.length}
              </Text>
            )}
          </View>
          {canEdit && j.nextStage && j.nextStageLabel && (
            <Button
              label={`${t('Move to')} ${t(j.nextStageLabel)}`}
              variant="secondary"
              icon="arrowRight"
              onPress={() => { void moveStage(j.nextStage!); }}
              loading={busy}
              style={{ marginTop: space.sm }}
            />
          )}
        </Card>
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
                    value={(i.fitStatus ?? 'to_fit') as 'to_fit' | 'fitted' | 'tested'}
                    options={[
                      { key: 'to_fit', label: t('To fit') },
                      { key: 'fitted', label: t('Fitted') },
                      { key: 'tested', label: t('Tested') },
                    ]}
                    onChange={(k) => { if (k !== i.fitStatus) void setFit(i, k); }}
                  />
                </>
              ) : (
                <Text variant="micro" color={c.inkSoft}>
                  {[i.placement, i.fitStatus === 'tested' ? t('Tested') : i.fitStatus === 'fitted' ? t('Fitted') : t('To fit')].filter(Boolean).join(' · ')}
                </Text>
              )}
            </View>
          )}
        </Card>
      ))}

      {j.items.length === 0 && (
        <Empty icon="box" title={t('Nothing on this challan')} line={t('The office has not added any lines yet.')} />
      )}

      {/*
        Said plainly rather than blocking the button. A fitting where one camera
        was swapped for a spare off the shelf is normal, and refusing to close
        the job would mean the technician leaves it open and the office chases
        it tomorrow.
      */}
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
