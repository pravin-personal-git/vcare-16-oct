/**
 * What a camera read of a barcode or QR code turns into.
 *
 * The camera hands back whatever the symbol encodes, which on real boxes means
 * trailing carriage returns, GS separators from GS1 labels, and the occasional
 * QR code holding a whole URL. This file decides what a read *is* before any
 * screen acts on it, so the GRN, the unit lookup and the header scanner all
 * agree on it.
 */

/** Longest thing we accept as one code. A QR code can hold far more; a serial never does. */
export const MAX_CODE_LENGTH = 256;

/**
 * Strip what the symbology adds and keep what a person would type.
 * Control characters (GS1's GS separator, CR/LF) become spaces, runs of space
 * collapse, and the ends are trimmed.
 */
export function cleanScannedCode(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CODE_LENGTH);
}

export type CodeKind = 'gstin' | 'upi' | 'url' | 'email' | 'phone' | 'text';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isGstin(s: string): boolean {
  return GSTIN.test(s.trim().toUpperCase());
}

/** What a scanned value looks like - decides what the header scanner offers to do with it. */
export function classifyCode(code: string): CodeKind {
  const c = code.trim();
  if (isGstin(c)) return 'gstin';
  if (/^upi:\/\//i.test(c)) return 'upi';
  if (/^https?:\/\//i.test(c)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return 'email';
  const digits = c.replace(/[\s()+-]/g, '');
  if (/^(?:91)?[6-9]\d{9}$/.test(digits) && !/[A-Za-z]/.test(c)) return 'phone';
  return 'text';
}

/**
 * Continuous scanning: the camera sees the same label many times a second.
 * A code is accepted once; the same code seen again is a repeat, and any code
 * inside the cooldown after an accepted one is ignored so a label half-in and
 * half-out of frame does not add a mis-read beside the real one.
 */
export interface CollectorState {
  codes: string[];
  lastAcceptedAt: number;
}

export const SCAN_COOLDOWN_MS = 900;

export function emptyCollector(): CollectorState {
  return { codes: [], lastAcceptedAt: 0 };
}

export function acceptScan(
  state: CollectorState,
  raw: string,
  now: number,
): { state: CollectorState; result: 'added' | 'repeat' | 'cooldown' | 'empty' } {
  const code = cleanScannedCode(raw);
  if (!code) return { state, result: 'empty' };
  const key = code.toUpperCase();
  if (state.codes.some((c) => c.toUpperCase() === key)) return { state, result: 'repeat' };
  if (now - state.lastAcceptedAt < SCAN_COOLDOWN_MS) return { state, result: 'cooldown' };
  return { state: { codes: [...state.codes, code], lastAcceptedAt: now }, result: 'added' };
}

/** Add scanned codes to a one-per-line serial box without repeating any already there. */
export function appendCodes(existing: string, codes: string[]): string {
  const have = new Set(
    existing.split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter(Boolean),
  );
  const add = codes.filter((c) => {
    const k = c.trim().toUpperCase();
    if (!k || have.has(k)) return false;
    have.add(k);
    return true;
  });
  if (add.length === 0) return existing;
  const base = existing.replace(/\s+$/, '');
  return base ? `${base}\n${add.join('\n')}` : add.join('\n');
}
