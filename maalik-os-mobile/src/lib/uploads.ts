import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, authed, authedUpload } from './api';
import { noteRefused, refreshCounts } from './outbox';
import { File } from 'expo-file-system';
import { fileSize, shrinkPhoto, UPLOAD_MAX_BYTES } from './shrink';

/**
 * Photos and voice notes on a job (13 Oct 2026, decisions 5 and 6), sent to
 * /api/v1/jobs/attachments. Recorded or taken without signal, they wait on
 * the phone and go when it is back - like the job steps (jobQueue) - so a
 * technician in a basement never loses what they said.
 */
export type JobDoc = 'complaint' | 'installation_challan';

export interface JobFile {
  id: string; fileName: string; mimeType: string; url: string | null; tag: string | null;
  uploadedAt: string; uploadedByName: string | null;
}

interface Pending { id: string; docType: JobDoc; docId: string; uri: string; name: string; type: string; at: string }

const QUEUE = 'maalik.uploads.queue.v1';

const read = async (): Promise<Pending[]> => {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? '[]') as Pending[]; } catch { return []; }
};
const write = (v: Pending[]) => AsyncStorage.setItem(QUEUE, JSON.stringify(v)).catch(() => undefined).then(() => { void refreshCounts(); });

export const jobFiles = (docType: JobDoc, docId: string) =>
  authed<{ files: JobFile[] }>(`/api/v1/jobs/attachments?docType=${docType}&docId=${encodeURIComponent(docId)}`);

/**
 * Make the file fit before it goes (16 Oct 2026): a photo over 1.5 MB is made
 * smaller (photos queued by 1.0.29, taken full size, are fixed here too), and
 * anything still over the limit is refused with a reason instead of being
 * sent to fail - the website stops requests over 4.5 MB, which the phone used
 * to read as "no signal".
 */
async function fit(p: Omit<Pending, 'id' | 'at'>): Promise<Omit<Pending, 'id' | 'at'>> {
  let out = p;
  const size = fileSize(p.uri);
  if (p.type.startsWith('image/') && (size === null || size > 1_500_000)) {
    const small = await shrinkPhoto(p.uri);
    if (small) out = { ...p, uri: small.uri, type: 'image/jpeg', name: p.name.replace(/\.\w+$/, '') + '.jpg' };
  }
  const final = fileSize(out.uri);
  if (final !== null && final > UPLOAD_MAX_BYTES) {
    throw new ApiError(`This ${p.type.startsWith('audio/') ? 'voice note' : 'file'} is too large to send (${(final / 1_048_576).toFixed(1)} MB, the limit is 4 MB).`, 413);
  }
  return out;
}

async function send(raw: Omit<Pending, 'id' | 'at'>) {
  const p = await fit(raw);
  const form = new FormData();
  form.append('docType', p.docType);
  form.append('docId', p.docId);
  // The file goes as { name, type, bytes } (16 Oct 2026). Expo replaces the
  // app's fetch with its own (expo/fetch), and that one cannot send React
  // Native's { uri, name, type } file part - it threw "Unsupported FormDataPart
  // implementation" before anything left the phone, which read as "no signal",
  // so no job photo or voice note ever reached the website.
  const file = new File(p.uri);
  form.append('file', { name: p.name, type: p.type, bytes: async () => new Uint8Array(await file.arrayBuffer()) } as unknown as Blob);
  return authedUpload<{ ok: true; id: string }>('/api/v1/jobs/attachments', form);
}

/** Upload now; with no signal, keep it for later. Returns 'sent' | 'queued'. Throws on a refusal (wrong type, no right). */
export async function uploadJobFile(p: Omit<Pending, 'id' | 'at'>): Promise<'sent' | 'queued'> {
  try {
    await send(p);
    return 'sent';
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const q = await read();
      q.push({ ...p, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() });
      await write(q);
      return 'queued';
    }
    throw e;
  }
}

export const pendingUploads = async (docId?: string) => (await read()).filter((p) => !docId || p.docId === docId);

let running = false;
/** Send what is waiting, oldest first. Stops at the first network failure. Never throws. */
export async function flushUploads(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const q = await read();
    const left: Pending[] = [];
    let offline = false;
    for (const p of q) {
      if (offline) { left.push(p); continue; }
      try { await send(p); } catch (e) {
        if (e instanceof ApiError && e.status === 0) { offline = true; left.push(p); continue; }
        // Refused (job gone, file too large): taken out of the line so it no
        // longer holds up the rest, and listed with its reason in Waiting to send.
        await noteRefused({
          label: p.type.startsWith('audio/') ? 'Voice note' : 'Photo', target: p.docId, at: p.at,
          message: e instanceof ApiError ? e.message : 'Not accepted.',
        });
      }
    }
    await write(left);
  } finally {
    running = false;
  }
}
