/**
 * "SCAN ANYWHERE" - telling a barcode reader from a person (13 Oct 2026).
 *
 * A USB or Bluetooth barcode reader is a keyboard: it types the code and
 * presses Enter. Into a focused box that already works everywhere in Atlas.
 * With NOTHING focused the keystrokes used to go nowhere; this decides when a
 * run of keys was a scan, so the header scanner can take it.
 *
 * A reader types a whole code in a few milliseconds per character; the
 * fastest person manages ~60-80 ms between keys and is uneven. So: at least
 * `minLength` printable characters, every gap at most `maxGapMs`, then Enter
 * within `enterGapMs`. Any slower key starts again; a key typed into an
 * editable field is never ours.
 *
 * Pure: time is passed in, so the rule is tested without a browser.
 */

export interface WedgeOptions {
  /** Longest gap between characters of one scan. */
  maxGapMs?: number;
  /** Some readers pause a little before the Enter suffix. */
  enterGapMs?: number;
  /** Shortest code worth treating as a scan. */
  minLength?: number;
}

export interface WedgeKey {
  /** KeyboardEvent.key */
  key: string;
  /** Milliseconds, any monotonic clock. */
  at: number;
  /** The key went into an input, textarea, select or contenteditable. */
  editable: boolean;
  /** Ctrl, Alt or Meta held - a shortcut, never part of a code. */
  modified: boolean;
}

export function createWedgeDetector(opts: WedgeOptions = {}) {
  const maxGap = opts.maxGapMs ?? 35;
  const enterGap = opts.enterGapMs ?? 100;
  const minLength = opts.minLength ?? 4;
  let buf = '';
  let last = -Infinity;

  const reset = () => { buf = ''; last = -Infinity; };

  /** Feed one keydown. Returns the scanned code when this key completes a scan, else null. */
  function feed(k: WedgeKey): string | null {
    if (k.editable || k.modified) { reset(); return null; }
    const gap = k.at - last;
    if (k.key === 'Enter') {
      const code = buf;
      const ok = code.length >= minLength && gap <= enterGap;
      reset();
      return ok ? code : null;
    }
    if (k.key.length !== 1) { if (k.key !== 'Shift') reset(); return null; }
    buf = gap <= maxGap && buf ? buf + k.key : k.key;
    last = k.at;
    return null;
  }

  return { feed, reset };
}

/** Whether a keydown target is somewhere a person types. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = String(el.tagName).toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
