import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import {
  createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
  RecordingPresets, type AudioPlayer,
} from 'expo-audio';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Text } from './ui';
import { Scanner } from './Scanner';
import { Icon } from './Icon';
import { SectionLabel, fmtDateTime } from './Kit';
import { ApiError } from '@/lib/api';
import { jobFiles, pendingUploads, uploadJobFile, type JobDoc, type JobFile } from '@/lib/uploads';
import { radius, space } from '@/theme/tokens';

/**
 * Photo and voice note on a job (13 Oct 2026, decisions 5 and 6): two big
 * buttons, and what is already on the job underneath. A voice note is the
 * technician's "what I did" without typing - recorded here, saved on the job
 * for the office to play. No signal: kept on the phone and sent later.
 */
export function JobMedia({ docType, docId, photo = true, voice = true }: { docType: JobDoc; docId: string; photo?: boolean; voice?: boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  const [files, setFiles] = useState<JobFile[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [camera, setCamera] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 500);
  const player = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await jobFiles(docType, docId); if (r) setFiles(r.files); } catch { /* offline - keep what we have */ }
    setWaiting((await pendingUploads(docId)).length);
  }, [docType, docId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- an async load; state is set when it resolves
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { player.current?.remove(); }, []);

  const send = async (uri: string, name: string, type: string, what: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await uploadJobFile({ docType, docId, uri, name, type });
      setMsg(r === 'sent'
        ? { tone: 'success', text: t(`${what} saved on the job.`) }
        : { tone: 'warning', text: t('No signal - saved on the phone. It will be sent automatically when you are back online.') });
      await refresh();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not save it. Try again.') });
    } finally { setBusy(false); }
  };

  const startVoice = async () => {
    setMsg(null);
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) { setMsg({ tone: 'warning', text: t('Allow the microphone to record a voice note.') }); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };
  const stopVoice = async (save: boolean) => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    const uri = recorder.uri;
    if (save && uri) await send(uri, `voice-note-${Date.now()}.m4a`, 'audio/mp4', 'Voice note');
  };

  const play = (f: JobFile) => {
    if (!f.url) return;
    player.current?.remove();
    if (playing === f.id) { player.current = null; setPlaying(null); return; }
    const p = createAudioPlayer(f.url);
    player.current = p;
    setPlaying(f.id);
    p.addListener('playbackStatusUpdate', (s) => { if (s.didJustFinish) setPlaying(null); });
    p.play();
  };

  const secs = Math.floor((rec.durationMillis ?? 0) / 1000);
  return (
    <>
      <SectionLabel>{t('Photo and voice note')}</SectionLabel>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {waiting > 0 && <Banner tone="warning">{t(`${waiting} file(s) waiting for signal.`)}</Banner>}
      {rec.isRecording ? (
        <Card style={{ alignItems: 'center', gap: space.md, borderColor: c.danger }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.danger }} />
            <Text variant="h2" weight="bold">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</Text>
          </View>
          <Text variant="small" color={c.inkSoft}>{t('Recording - say what you did')}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' }}>
            <View style={{ flex: 2 }}><Button label={t('Stop and save')} icon="check" onPress={() => void stopVoice(true)} /></View>
            <View style={{ flex: 1 }}><Button label={t('Cancel')} variant="secondary" onPress={() => void stopVoice(false)} /></View>
          </View>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {photo && <View style={{ flex: 1 }}><Button label={t('Photo')} icon="camera" variant="secondary" loading={busy && !rec.isRecording} onPress={() => setCamera(true)} /></View>}
          {voice && <View style={{ flex: 1 }}><Button label={t('Voice note')} icon="mic" variant="secondary" disabled={busy} onPress={() => void startVoice()} /></View>}
        </View>
      )}
      {files.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {files.slice(0, 12).map((f) => f.mimeType.startsWith('image/') && f.url ? (
            <Image key={f.id} source={{ uri: f.url }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: c.surface2 }} />
          ) : f.mimeType.startsWith('audio/') ? (
            <Pressable key={f.id} accessibilityRole="button" onPress={() => play(f)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: playing === f.id ? c.brand : c.line, backgroundColor: c.surface }}>
              <Icon name={playing === f.id ? 'stop' : 'play'} size={16} color={c.brand} />
              <Text variant="small">{`${t('Voice note')} · ${fmtDateTime(f.uploadedAt)}`}</Text>
            </Pressable>
          ) : null)}
        </View>
      )}
      <Scanner visible={camera} mode="photo" title={t('Photo of the job')} quality={0.5}
        onPhoto={(_b64, uri) => { if (uri) void send(uri, `photo-${Date.now()}.jpg`, 'image/jpeg', 'Photo'); }}
        onClose={() => setCamera(false)} />
    </>
  );
}

/** Where the job is, as a row of steps (simple layout): Accept · On the way · On site · Work done · Customer code. */
const STEPS: { label: string; statuses: string[] }[] = [
  { label: 'Accept', statuses: ['assigned', 'received'] },
  { label: 'On the way', statuses: ['accepted', 'scheduled', 'on_the_way'] },
  { label: 'On site', statuses: ['on_site', 'in_progress'] },
  { label: 'Work done', statuses: ['awaiting_estimate', 'awaiting_customer'] },
  { label: 'Customer code', statuses: ['resolved', 'closed'] },
];

export function JobStepper({ status }: { status: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const at = Math.max(0, STEPS.findIndex((s) => s.statuses.includes(status)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {STEPS.map((s, i) => {
        const done = i < at, now = i === at;
        const col = done ? c.success : now ? c.brand : c.line;
        return (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ flex: 1, height: 3, backgroundColor: i === 0 ? 'transparent' : (done || now ? col : c.line) }} />
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: done || now ? col : c.surface, borderWidth: 2, borderColor: col, alignItems: 'center', justifyContent: 'center' }}>
                {done ? <Icon name="check" size={14} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1, height: 3, backgroundColor: i === STEPS.length - 1 ? 'transparent' : (done ? col : c.line) }} />
            </View>
            <Text variant="micro" weight={now ? 'bold' : 'regular'} color={now ? c.brand : c.inkSoft} align="center">{t(s.label)}</Text>
          </View>
        );
      })}
    </View>
  );
}
