import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, authed, authedUpload } from './api';
import { refreshCounts } from './outbox';

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

function send(p: Omit<Pending, 'id' | 'at'>) {
  const form = new FormData();
  form.append('docType', p.docType);
  form.append('docId', p.docId);
  // React Native's FormData takes a file as { uri, name, type }.
  form.append('file', { uri: p.uri, name: p.name, type: p.type } as unknown as Blob);
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
        if (e instanceof ApiError && e.status === 0) { offline = true; left.push(p); }
        // Refused by the server (job gone, file missing): dropped.
      }
    }
    await write(left);
  } finally {
    running = false;
  }
}
