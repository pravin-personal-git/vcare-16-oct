import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNoSignal } from './net';
import { refreshCounts } from './outbox';
import { complaintAction } from './jobs';

/**
 * Job steps done without signal (workflow slice 8, spec §4.10, Pravin round
 * 4): On my way, Working on site (with the GPS reading taken at the tap),
 * Leaving site, Work done, notes and taking items for repair (pickup, stage 8)
 * are kept on the phone and sent in order
 * when signal returns. Each carries its own id, so the server applies it once
 * even if it is sent twice, and the time it was tapped, so time on site is
 * right. Challans, the customer's code and accept/decline need signal.
 *
 * A step the server refuses when it finally arrives (the office changed the
 * job meanwhile) is dropped and listed, so the technician sees why.
 */

const QUEUE = 'maalik.jobs.queue.v1';
const FAILED = 'maalik.jobs.failed.v1';
const SEND_MS = 20_000;
const STALE_MS = 3 * 60_000;

/**
 * F-13 (13 Oct 2026): accepting a job, booking / moving a visit, raising a
 * parts challan and reporting unused / faulty parts queue too. Only the
 * customer's code (an SMS round trip) still needs signal. Changing or
 * withdrawing a challan queues too (22 Oct 2026) - if it was approved
 * meanwhile, the server refuses it and the reason is listed.
 */
export const QUEUEABLE = new Set([
  'on_the_way', 'on_site', 'leave_site', 'work_done', 'note', 'pickup',
  'accept', 'book_visit', 'change_visit', 'raise_challan', 'unused_parts', 'faulty_part',
  'edit_challan', 'withdraw_challan',
]);

export interface QueuedStep { opId: string; complaintId: string; body: Record<string, unknown>; at: string; label: string }
export interface FailedStep { complaintId: string; label: string; message: string; at: string }

async function read<T>(key: string): Promise<T[]> {
  try { return JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as T[]; } catch { return []; }
}
const write = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined).then(() => { void refreshCounts(); });

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Keep a step to send later. */
export async function enqueueJobStep(complaintId: string, body: Record<string, unknown>, label: string): Promise<void> {
  const q = await read<QueuedStep>(QUEUE);
  q.push({ opId: newId(), complaintId, body, at: new Date().toISOString(), label });
  await write(QUEUE, q);
}

export const pendingJobSteps = async (complaintId?: string) =>
  (await read<QueuedStep>(QUEUE)).filter((s) => !complaintId || s.complaintId === complaintId);
export const failedJobSteps = async (complaintId?: string) =>
  (await read<FailedStep>(FAILED)).filter((s) => !complaintId || s.complaintId === complaintId);
export async function clearFailedJobSteps(complaintId: string) {
  await write(FAILED, (await read<FailedStep>(FAILED)).filter((s) => s.complaintId !== complaintId));
}

const timed = <T>(p: Promise<T>) => Promise.race([
  p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), SEND_MS)),
]);

let running: Promise<number> | null = null;
let startedAt = 0;

/** Send what is waiting, oldest first. Stops at the first network failure. Never throws. */
export function flushJobQueue(): Promise<number> {
  if (running && Date.now() - startedAt > STALE_MS) running = null;
  if (running) return running;
  startedAt = Date.now();
  running = (async () => {
    let sent = 0;
    try {
      let q = await read<QueuedStep>(QUEUE);
      while (q.length) {
        const s = q[0];
        try {
          const r = await timed(complaintAction(s.complaintId, { ...s.body, opId: s.opId, at: s.at }));
          if (r === null) break; // signed out
          if (r.onSite && !r.onSite.ok) {
            await write(FAILED, [...await read<FailedStep>(FAILED), { complaintId: s.complaintId, label: s.label, message: r.onSite.message ?? 'Not accepted at the site.', at: s.at }]);
          } else sent += 1;
        } catch (e) {
          /*
            Still no signal - try again later. 13 Oct 2026 (F-13): this read
            `!(e instanceof ApiError)`, but a request that never reaches the
            server comes back as an ApiError with status 0 - so every queued
            step that met no signal was taken as refused and dropped.
          */
          if (isNoSignal(e)) break;
          await write(FAILED, [...await read<FailedStep>(FAILED), { complaintId: s.complaintId, label: s.label, message: e instanceof Error ? e.message : 'Not accepted.', at: s.at }]);
        }
        q = q.slice(1);
        await write(QUEUE, q);
      }
    } finally {
      running = null;
    }
    return sent;
  })();
  return running;
}
