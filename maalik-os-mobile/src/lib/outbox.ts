import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, authed } from './api';
import { isNoSignal } from './net';

/**
 * OFFLINE, PART 2 - ONE OUTBOX FOR CHANGES (F-13, 13 Oct 2026).
 *
 * A change made with no signal (an installation scan, a task done, a visit
 * moved, a lead note, a leave request, an approval...) is kept here and sent,
 * in the order it was made, when the signal is back. Each carries its own id
 * (`x-op-id`) so the server applies it once even if it arrives twice
 * (server/auth/v1-staff, PhoneOp), and the moment it was made (`at`).
 *
 * The office wins (decision Q4): something the server refuses when it finally
 * arrives - the job was closed, the item already fitted - is taken off the
 * queue and listed on the Waiting to send screen with the server's reason.
 * Nothing behind it is held up or lost.
 *
 * Job steps keep their own older queue (lib/jobQueue) - it carries the GPS
 * reading and the on-site check; uploads keep theirs (lib/uploads).
 */
export interface Queued { ok: true; queued: true; message: string }
export interface OutboxItem { opId: string; path: string; body: Record<string, unknown>; label: string; target: string | null; at: string }
export interface Refused { label: string; target: string | null; message: string; at: string }

const QUEUE = 'maalik.outbox.v1';
const REFUSED = 'maalik.outbox.refused.v1';
const QUEUED_MESSAGE = 'No signal - saved on the phone. It will be sent automatically when you are back online.';

async function read<T>(key: string): Promise<T[]> {
  try { return JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as T[]; } catch { return []; }
}
async function write(key: string, v: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined);
  void refreshCounts();
}

const newId = () => `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const isQueued = (r: unknown): r is Queued => !!r && typeof r === 'object' && (r as { queued?: unknown }).queued === true;

function post<T>(item: Pick<OutboxItem, 'path' | 'body' | 'opId' | 'at'>) {
  return authed<T>(item.path, {
    method: 'POST',
    headers: { 'x-op-id': item.opId },
    body: JSON.stringify({ ...item.body, at: item.at }),
  });
}

/**
 * Send a change now; with no signal, keep it and answer `Queued`.
 * A refusal from the server is thrown as before (the screen shows it).
 * `target` ties it to a record (e.g. "installation:<id>") so that screen can say what is waiting.
 */
export async function send<T>(path: string, body: Record<string, unknown>, meta: { label: string; target?: string | null }): Promise<T | Queued | null> {
  const item: OutboxItem = { opId: newId(), path, body, label: meta.label, target: meta.target ?? null, at: new Date().toISOString() };
  // Something older is still waiting: this one goes behind it, so the order holds.
  if ((await read<OutboxItem>(QUEUE)).length > 0) {
    await write(QUEUE, [...await read<OutboxItem>(QUEUE), item]);
    void flushOutbox();
    return { ok: true, queued: true, message: QUEUED_MESSAGE };
  }
  try {
    return await post<T>(item);
  } catch (e) {
    if (!isNoSignal(e)) throw e;
    await write(QUEUE, [...await read<OutboxItem>(QUEUE), item]);
    return { ok: true, queued: true, message: QUEUED_MESSAGE };
  }
}

let running: Promise<void> | null = null;

/** Send what is waiting, oldest first; stops at the first "no signal". Never throws. */
export function flushOutbox(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      for (;;) {
        const q = await read<OutboxItem>(QUEUE);
        const item = q[0];
        if (!item) break;
        try {
          const r = await post<unknown>(item);
          if (r === null) break; // signed out
        } catch (e) {
          if (isNoSignal(e)) break;
          await write(REFUSED, [...await read<Refused>(REFUSED), {
            label: item.label, target: item.target, at: item.at,
            message: e instanceof ApiError ? e.message : 'Not accepted.',
          }]);
        }
        await write(QUEUE, (await read<OutboxItem>(QUEUE)).filter((x) => x.opId !== item.opId));
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

export const waiting = async (target?: string) => (await read<OutboxItem>(QUEUE)).filter((x) => !target || x.target === target);
export const refused = () => read<Refused>(REFUSED);
export const clearRefused = () => write(REFUSED, []);

// ------------------------------------------------------------- the badge

let counts = { waiting: 0, refused: 0 };
const listeners = new Set<() => void>();

/** Everything waiting to go - this outbox, job steps and photos / voice notes. */
export async function refreshCounts() {
  const [q, r, jobs, jobFailed, files] = await Promise.all([
    read<OutboxItem>(QUEUE), read<Refused>(REFUSED),
    read<unknown>('maalik.jobs.queue.v1'), read<unknown>('maalik.jobs.failed.v1'), read<unknown>('maalik.uploads.queue.v1'),
  ]);
  const next = { waiting: q.length + jobs.length + files.length, refused: r.length + jobFailed.length };
  if (next.waiting !== counts.waiting || next.refused !== counts.refused) {
    counts = next;
    listeners.forEach((l) => l());
  }
}

export function useOutboxCounts() {
  return useSyncExternalStore((l) => { listeners.add(l); void refreshCounts(); return () => { listeners.delete(l); }; }, () => counts, () => counts);
}
