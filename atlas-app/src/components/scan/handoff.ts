'use client';

import type { ScanResult } from '@/lib/scan/extraction';

/**
 * Carrying a scan from the header to the screen that uses it.
 *
 * The header scanner reads a supplier invoice, then sends the person to Goods
 * Receipt with the form already filled. The photo is a Blob - too big and the
 * wrong type for the URL or sessionStorage - so it rides in memory across the
 * client-side navigation, which keeps module state. A full reload drops it,
 * which is the right outcome: a stale scan should not reappear later.
 */

export interface Handoff {
  result: ScanResult;
  photo: Blob | null;
  at: number;
}

let pending: Handoff | null = null;

export function setHandoff(result: ScanResult, photo: Blob | null) {
  pending = { result, photo, at: Date.now() };
}

/** Take the pending scan if it is of this kind and recent. It is removed either way it is taken. */
export function takeHandoff<K extends ScanResult['kind']>(
  kind: K,
): { result: Extract<ScanResult, { kind: K }>; photo: Blob | null } | null {
  if (!pending || pending.result.kind !== kind || Date.now() - pending.at > 5 * 60_000) return null;
  const p = pending;
  pending = null;
  return { result: p.result as Extract<ScanResult, { kind: K }>, photo: p.photo };
}

/**
 * "Receive this" from the header scanner (Scan-to-Stock G2/G5, 12 Oct 2026):
 * a product - just created from a scan, or already known - and, when the scan
 * carried one, the box's serial. Goods Receipt opens with that line.
 */
export interface ReceiveHandoff {
  product: { id: string; name: string; code: string; trackingMode: string };
  serial: string | null;
  at: number;
}

let pendingReceive: ReceiveHandoff | null = null;

export function setReceiveHandoff(product: ReceiveHandoff['product'], serial: string | null = null) {
  pendingReceive = { product, serial, at: Date.now() };
}

export function takeReceiveHandoff(): ReceiveHandoff | null {
  if (!pendingReceive || Date.now() - pendingReceive.at > 5 * 60_000) { pendingReceive = null; return null; }
  const p = pendingReceive;
  pendingReceive = null;
  return p;
}
