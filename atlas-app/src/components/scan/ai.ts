'use client';

import type { ScanKind, ScanResult } from '@/lib/scan/extraction';

/**
 * The client side of AI reading: is it available, and read this photo.
 *
 * The status is fetched once and kept for a minute, so every scan button on a
 * page does not ask the server separately whether it may show itself.
 */

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  used: number;
  limit: number;
  remaining: number;
}

let cached: { at: number; value: Promise<AiStatus> } | null = null;

export function fetchAiStatus(force = false): Promise<AiStatus> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = fetch('/api/scan/status', { cache: 'no-store' })
    .then((r) => r.json() as Promise<AiStatus>)
    .catch(() => ({ enabled: false, configured: false, used: 0, limit: 0, remaining: 0 }));
  cached = { at: Date.now(), value };
  return value;
}

/** Why AI reading is unavailable right now, in words a shop owner can act on. Null when it is available. */
export function aiUnavailableReason(s: AiStatus): string | null {
  if (!s.enabled) return 'Reading text with AI is turned off. An admin can turn it on in Settings → Organisation → AI scanning.';
  if (!s.configured) return 'AI reading is not set up on the server yet (the Anthropic key is missing).';
  if (s.remaining <= 0) return `This month's ${s.limit} AI reads are used up. An admin can raise the limit in Settings → Organisation.`;
  return null;
}

export async function readPhoto(kind: ScanKind, photo: Blob): Promise<ScanResult> {
  const body = new FormData();
  body.set('kind', kind);
  body.set('file', new File([photo], `${kind}.jpg`, { type: photo.type || 'image/jpeg' }));
  let res: Response;
  try {
    res = await fetch('/api/scan/read', { method: 'POST', body });
  } catch {
    throw new Error('Could not reach the server. Check the connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  cached = null; // the count moved
  if (!res.ok) throw new Error(json.error ?? 'Could not read that photo.');
  return json as ScanResult;
}

/**
 * Attach the photo a record was filled from, once the record exists.
 * Failure is reported but never undoes the save - the data is what matters;
 * the photo is the receipt for it.
 */
export async function attachScanPhoto(
  docType: 'goods_receipt' | 'lead',
  docId: string,
  photo: Blob,
  label: string,
): Promise<string | null> {
  const body = new FormData();
  body.set('docType', docType);
  body.set('docId', docId);
  body.set('label', label);
  body.set('file', new File([photo], `${docType}-scan.jpg`, { type: 'image/jpeg' }));
  try {
    const res = await fetch('/api/attachments', { method: 'POST', body });
    if (res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json.error ?? 'The photo could not be attached.';
  } catch {
    return 'The photo could not be attached.';
  }
}
