/**
 * BARCODE OR SERIAL? (Scan-to-Stock, 12 Oct 2026.)
 *
 * The camera hands Atlas a string; nothing in it says "model" or "this box".
 * Atlas answers in four checks, in order - the same ones the approved demo
 * showed (09-documentation/scan-to-stock-demo.html):
 *
 *   1. On file?      a product's barcode or code = the MODEL; a unit's serial
 *                    or house tag = ONE BOX. (A database question - asked by
 *                    the caller; this file answers the other three.)
 *   2. GS1 element string?  (01) carries the GTIN, (21) the serial - both at once.
 *   3. Shape?        8, 12, 13 or 14 digits whose check digit adds up is a
 *                    retail barcode. Letters, dashes, other lengths or a failed
 *                    check digit: not a retail barcode, so almost certainly a serial.
 *   4. Where?        a line waiting for serials reads the next scan as a serial;
 *                    with nothing waiting and no clear shape, ASK - never guess.
 *
 * Pure and shared: the header scanner, the website receipt, stock-in by scan
 * and (vendored) the phone all agree on what a scan is.
 */

/** The GS1 check digit for the digits before it (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  // Weights 3,1,3,1... counted from the digit next to the check digit.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

/** A retail barcode: 8, 12, 13 or 14 digits with a correct check digit. */
export function isRetailBarcode(code: string): boolean {
  const c = code.trim();
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false;
  return gs1CheckDigit(c.slice(0, -1)) === Number(c.slice(-1));
}

/** GTIN-14 with a leading 0 is the same item as its EAN-13; keep the short form people see on the box. */
export function normaliseGtin(gtin: string): string {
  return gtin.length === 14 && gtin.startsWith('0') ? gtin.slice(1) : gtin;
}

/**
 * A GS1 element string, bracketed "(01)…(21)…" or raw with the GS separator
 * already turned to a space by `cleanScannedCode` ("01089041308964222 1DS2…").
 */
export function parseGs1(code: string): { gtin: string; serial: string | null } | null {
  const c = code.trim();
  if (c.startsWith('(01)')) {
    const g = /\(01\)(\d{14})/.exec(c);
    if (!g || !isRetailBarcode(g[1]!)) return null;
    const sn = /\(21\)([^()]+)/.exec(c);
    return { gtin: normaliseGtin(g[1]!), serial: sn?.[1]?.trim() || null };
  }
  // Raw: "01" + GTIN-14, then optionally "21" + serial up to the separator.
  const raw = /^01(\d{14})(.*)$/.exec(c);
  if (!raw || !isRetailBarcode(raw[1]!)) return null;
  const rest = raw[2]!.trim();
  const serial = rest.startsWith('21') ? rest.slice(2).split(' ')[0]!.trim() || null : null;
  if (rest && !serial && !/^\d/.test(rest)) return null;
  return { gtin: normaliseGtin(raw[1]!), serial };
}

export type ScanShape =
  | { kind: 'gs1'; gtin: string; serial: string | null; why: string }
  | { kind: 'barcode'; why: string }
  | { kind: 'serial'; why: string }
  | { kind: 'unclear'; why: string };

/** Checks 2 and 3: what the code looks like, said in words for the screen. */
export function scanShape(code: string): ScanShape {
  const c = code.trim();
  const g = parseGs1(c);
  if (g) {
    return { kind: 'gs1', gtin: g.gtin, serial: g.serial, why: g.serial ? `GS1 code: barcode ${g.gtin} and serial ${g.serial} in one` : `GS1 code carrying barcode ${g.gtin}` };
  }
  if (isRetailBarcode(c)) return { kind: 'barcode', why: `${c.length} digits with a correct check digit - a product barcode` };
  if (/^\d+$/.test(c) && [8, 12, 13, 14].includes(c.length)) {
    return { kind: 'serial', why: 'Barcode-length digits, but the check digit does not add up - not a product barcode' };
  }
  if (/[A-Za-z]/.test(c) && /\d/.test(c)) return { kind: 'serial', why: 'Letters and digits - product barcodes are digits only' };
  if (/^[A-Za-z0-9][A-Za-z0-9\-/_.]*$/.test(c) && /[-/_.]/.test(c)) return { kind: 'serial', why: 'Has dashes or slashes - product barcodes never do' };
  return { kind: 'unclear', why: 'Could be either' };
}

export type ScanReading =
  | { as: 'barcode'; code: string; why: string }
  | { as: 'serial'; code: string; why: string }
  | { as: 'both'; barcode: string; serial: string; why: string }
  | { as: 'ask'; code: string; why: string };

/**
 * Check 4: how to read an UNKNOWN code (not on file), given where it was
 * scanned. `waitingForSerial`: a receipt or sale line that still needs serials.
 */
export function readUnknownScan(code: string, waitingForSerial: boolean): ScanReading {
  const s = scanShape(code);
  if (s.kind === 'gs1') return s.serial ? { as: 'both', barcode: s.gtin, serial: s.serial, why: s.why } : { as: 'barcode', code: s.gtin, why: s.why };
  if (s.kind === 'barcode') return { as: 'barcode', code: code.trim(), why: s.why };
  if (s.kind === 'serial') return { as: 'serial', code: code.trim(), why: s.why };
  if (waitingForSerial) return { as: 'serial', code: code.trim(), why: 'A line is waiting for serials' };
  return { as: 'ask', code: code.trim(), why: 'Not a product barcode shape, and nothing is waiting for a serial' };
}
