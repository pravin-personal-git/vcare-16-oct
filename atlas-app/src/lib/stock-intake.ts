import { parseCsv, rowsToObjects } from './csv';
import { isTrackingMode, type TrackingMode } from './stock-tracking';

/**
 * THE INTAKE DOOR - how stock gets in, planned before anything is written.
 *
 * Every unit must enter through a receipt or through opening stock; a unit
 * created any other way has no purchase price and no supplier, and stays
 * permanently incomplete. So the door is built before the room, and it has to
 * be fast enough that people actually use it:
 *
 *   serials       scanned one at a time, or a column pasted from a supplier
 *                 spreadsheet - both arrive here as text
 *   placeholders  "50 arrived, serials to follow" - 50 units, serial blank
 *   count         "50 arrived, no serials" - quantity only, no units
 *
 * Pure, so the rules - above all "the number of serials must equal the number
 * received" - are tested without a database.
 */

export const CAPTURE_MODES = ['serials', 'placeholders', 'count'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const CAPTURE_LABEL: Record<CaptureMode, string> = {
  serials: 'Scan or paste serials',
  placeholders: 'Serials to follow',
  count: 'No serials on the items',
};

/**
 * What each mode actually does, for the person choosing between them.
 *
 * Rewritten 2 Oct 2026, because the difference between the last two changed.
 * `count` used to mean "no unit records at all", which is how 39,000 items came
 * to exist that Atlas could not name. It now means "Atlas issues the numbers",
 * and `placeholders` is for when the vendor's number IS on the box and is
 * simply not typed yet.
 */
export const CAPTURE_HINT: Record<CaptureMode, string> = {
  serials: 'The number is printed on each item and you are entering it now.',
  placeholders: 'The number is printed on the items but you will type it later. '
    + 'Each item gets a record with its serial still blank.',
  count: 'Nothing is printed on the items. Atlas gives each one a number - print '
    + 'the labels from the stock list and stick them on.',
};

/** Longest serial we accept. Anything longer is two serials pasted as one. */
export const MAX_SERIAL_LENGTH = 64;

/**
 * Read serials out of pasted or scanned text.
 *
 * Splits on newlines, tabs, commas and semicolons - a column pasted from
 * Excel arrives newline-separated, a row pasted from one arrives tab-separated,
 * and people type commas. Spaces are NOT separators: some real serials carry
 * them, and splitting "AB 1234" into two units would invent a unit.
 *
 * Case is preserved, since some manufacturers' serials are case-sensitive,
 * but duplicates are detected case-insensitively - a scanner and a person
 * typing the same label will disagree on case, and that is still one unit.
 */
export function parseSerialList(text: string): {
  serials: string[];
  duplicates: string[];
  tooLong: string[];
} {
  const raw = text.split(/[\r\n\t,;]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const serials: string[] = [];
  const duplicates: string[] = [];
  const tooLong: string[] = [];

  for (const s of raw) {
    if (s.length > MAX_SERIAL_LENGTH) { tooLong.push(s); continue; }
    const key = s.toUpperCase();
    if (seen.has(key)) { duplicates.push(s); continue; }
    seen.add(key);
    serials.push(s);
  }
  return { serials, duplicates, tooLong };
}

export interface ReceiptLineInput {
  productName: string;
  trackingMode: string;
  qty: number;
  capture?: CaptureMode;
  serials?: string[];
  /**
   * Boxes on a serial line whose serial cannot be read (a torn sticker),
   * received by scanning the product barcode instead (Scan-to-Stock G4,
   * 12 Oct 2026; decision: house tag now). Atlas numbers them at posting.
   */
  noSerial?: number;
  lotNo?: string | null;
  expiryDate?: Date | null;
}

export type ReceiptLinePlan =
  | {
    ok: true;
    /** Whether the line moves stock at all. False for a `none` product. */
    movesStock: boolean;
    /** Units to create: a serial each, or null for a placeholder. Empty unless `serial`. */
    units: (string | null)[];
    /** The lot this line fills, for a `batch` product. */
    lotNo: string | null;
    /** Said out loud rather than enforced - see the count-only case. */
    warning: string | null;
  }
  | { ok: false; reason: string };

/**
 * What one receipt line will create.
 *
 * The rule that matters: for a serialised product captured by serial, the
 * number of serials must EQUAL the quantity. Not "at most" - a line that says
 * 10 arrived and lists 9 serials has either a missing unit or a wrong count,
 * and guessing which is how a shelf and a ledger start to disagree.
 */
export function planReceiptLine(l: ReceiptLineInput): ReceiptLinePlan {
  const name = l.productName.trim() || 'This line';
  if (!Number.isInteger(l.qty) || l.qty <= 0) {
    return { ok: false, reason: `${name}: the quantity must be a whole number above zero.` };
  }

  const mode: TrackingMode = isTrackingMode(l.trackingMode) ? l.trackingMode : 'quantity';
  const serials = l.serials ?? [];

  if (mode !== 'serial' && serials.length > 0) {
    return {
      ok: false,
      reason: `${name} is not tracked by serial number, so its serials would be thrown away. `
        + 'Remove them, or change how the product is tracked first.',
    };
  }

  if (mode === 'none') {
    return { ok: true, movesStock: false, units: [], lotNo: null, warning: `${name} is not stocked, so nothing goes on the shelf.` };
  }

  if (mode === 'quantity') {
    return { ok: true, movesStock: true, units: [], lotNo: null, warning: null };
  }

  if (mode === 'batch') {
    const lotNo = l.lotNo?.trim() || '';
    if (!lotNo) return { ok: false, reason: `${name} is tracked by batch. Enter the lot number from the pack.` };
    if (l.expiryDate && Number.isNaN(l.expiryDate.getTime())) {
      return { ok: false, reason: `${name}: that expiry date is not a date.` };
    }
    return { ok: true, movesStock: true, units: [], lotNo, warning: null };
  }

  // serial
  const capture: CaptureMode = l.capture ?? 'serials';

  if (capture === 'count') {
    return {
      ok: true, movesStock: true, units: [], lotNo: null,
      // No longer "no unit records" - see CAPTURE_HINT above. Still a warning,
      // because the clerk has to print and stick the labels for it to be true
      // of the physical items and not only of the database.
      warning: `${name}: ${l.qty} items with no serial on them. Atlas will number each one - `
        + 'print the labels from the stock list and stick them on.',
    };
  }

  if (capture === 'placeholders') {
    return { ok: true, movesStock: true, units: Array.from({ length: l.qty }, () => null), lotNo: null, warning: null };
  }

  const { serials: clean, duplicates, tooLong } = parseSerialList(serials.join('\n'));
  if (tooLong.length > 0) {
    return { ok: false, reason: `${name}: "${tooLong[0].slice(0, 24)}..." is too long to be one serial - were two pasted together?` };
  }
  if (duplicates.length > 0) {
    return { ok: false, reason: `${name}: ${duplicates.join(', ')} appears more than once.` };
  }
  const noSerial = Math.max(0, Math.floor(Number(l.noSerial) || 0));
  if (clean.length + noSerial !== l.qty) {
    return {
      ok: false,
      reason: `${name}: ${l.qty} received but ${clean.length} serial${clean.length === 1 ? '' : 's'} entered`
        + `${noSerial ? ` and ${noSerial} without one` : ''}. `
        + 'They must match - or receive the rest as "serials to follow".',
    };
  }
  // The boxes without a readable serial get house tags at posting: `units`
  // is shorter than the quantity, and completeLineSerials numbers the rest.
  return {
    ok: true, movesStock: true, units: clean, lotNo: null,
    warning: noSerial
      ? `${name}: ${noSerial} box${noSerial === 1 ? '' : 'es'} without a readable serial - Atlas issues house tags; print and stick them.`
      : null,
  };
}

/* ------------------------------------------------------------ opening stock */

/**
 * The template a client fills in. Every future client arrives with nothing,
 * so this is a product requirement, not a migration convenience.
 */
export const OPENING_STOCK_HEADERS = [
  'Product code', 'Quantity', 'Serial', 'Lot', 'Expiry date', 'Unit cost', 'Condition',
] as const;

export interface OpeningProduct {
  id: string;
  productCode: string;
  productName: string;
  trackingMode: string;
}

export interface OpeningPlanLine {
  productId: string;
  productCode: string;
  productName: string;
  trackingMode: TrackingMode;
  qty: number;
  /** Serials, or nulls for placeholders. Empty unless `serial`. */
  units: (string | null)[];
  lotNo: string | null;
  expiryDate: Date | null;
  unitCostPaise: number | null;
  refurbished: boolean;
}

export interface OpeningPlan {
  lines: OpeningPlanLine[];
  /** One per rejected row, with the row number as the person sees it in Excel. */
  errors: { row: number; reason: string }[];
}

const HEADER_KEYS: Record<string, string[]> = {
  code: ['product code', 'code', 'product'],
  qty: ['quantity', 'qty'],
  serial: ['serial', 'serial no', 'serial number', 'barcode'],
  lot: ['lot', 'lot no', 'batch', 'batch no'],
  expiry: ['expiry date', 'expiry', 'exp'],
  cost: ['unit cost', 'cost', 'purchase price'],
  condition: ['condition'],
};

const col = (row: Record<string, string>, key: keyof typeof HEADER_KEYS) => {
  for (const h of HEADER_KEYS[key]) if (h in row) return (row[h] ?? '').trim();
  return '';
};

/** `YYYY-MM-DD` or `DD/MM/YYYY`, both read as local midnight. */
export function parseLooseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return new Date(NaN);
}

/**
 * Turn an opening-stock CSV into a plan, row by row, refusing what is wrong
 * rather than guessing.
 *
 * Serialised products take ONE ROW PER UNIT with its serial - that is the only
 * shape that says which serial is which. A serialised row with no serial and a
 * quantity becomes that many placeholders, which is honest: the units exist,
 * their serials are to follow. Rows for the same product and lot are merged.
 *
 * Nothing is written by this function. The screen shows the plan and its
 * errors, and only a plan with no errors can be imported.
 */
export function planOpeningStock(csvText: string, products: OpeningProduct[]): OpeningPlan {
  const { rows } = rowsToObjects(parseCsv(csvText));
  const byCode = new Map(products.map((p) => [p.productCode.trim().toUpperCase(), p]));
  const errors: { row: number; reason: string }[] = [];
  const merged = new Map<string, OpeningPlanLine>();
  const serialsSeen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1 in the spreadsheet
    const code = col(r, 'code');
    if (!code) { errors.push({ row: rowNo, reason: 'No product code.' }); return; }

    const p = byCode.get(code.toUpperCase());
    if (!p) { errors.push({ row: rowNo, reason: `No product with code "${code}".` }); return; }

    const mode: TrackingMode = isTrackingMode(p.trackingMode) ? p.trackingMode : 'quantity';
    if (mode === 'none') {
      errors.push({ row: rowNo, reason: `${p.productName} is not stocked, so it cannot have opening stock.` });
      return;
    }

    const serial = col(r, 'serial');
    const qtyRaw = col(r, 'qty');
    const qty = qtyRaw === '' ? (serial ? 1 : NaN) : Number(qtyRaw.replace(/,/g, ''));
    if (!Number.isInteger(qty) || qty <= 0) {
      errors.push({ row: rowNo, reason: `Quantity "${qtyRaw}" is not a whole number above zero.` });
      return;
    }

    if (serial && mode !== 'serial') {
      errors.push({ row: rowNo, reason: `${p.productName} is not tracked by serial number - leave Serial blank.` });
      return;
    }
    if (serial && qty !== 1) {
      errors.push({ row: rowNo, reason: 'A row with a serial is one unit. Use one row per serial.' });
      return;
    }
    if (serial) {
      const key = `${p.id}|${serial.toUpperCase()}`;
      if (serialsSeen.has(key)) { errors.push({ row: rowNo, reason: `Serial ${serial} appears twice.` }); return; }
      serialsSeen.add(key);
    }

    const lotNo = col(r, 'lot') || null;
    if (mode === 'batch' && !lotNo) {
      errors.push({ row: rowNo, reason: `${p.productName} is tracked by batch - enter its lot number.` });
      return;
    }
    if (mode !== 'batch' && lotNo) {
      errors.push({ row: rowNo, reason: `${p.productName} is not tracked by batch - leave Lot blank.` });
      return;
    }

    const expiryDate = parseLooseDate(col(r, 'expiry'));
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      errors.push({ row: rowNo, reason: `Expiry "${col(r, 'expiry')}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY.` });
      return;
    }

    const costRaw = col(r, 'cost');
    let unitCostPaise: number | null = null;
    if (costRaw) {
      const n = Number(costRaw.replace(/[,\s₹]/g, ''));
      if (!Number.isFinite(n) || n < 0) { errors.push({ row: rowNo, reason: `Unit cost "${costRaw}" is not an amount.` }); return; }
      unitCostPaise = Math.round(n * 100);
    }

    const cond = col(r, 'condition').toLowerCase();
    if (cond && cond !== 'new' && cond !== 'refurbished') {
      errors.push({ row: rowNo, reason: `Condition must be "new" or "refurbished", not "${cond}".` });
      return;
    }
    const refurbished = cond === 'refurbished';

    // Merge rows that describe the same stock. Serialised rows merge per
    // product + condition + cost, so each unit keeps its own serial.
    const key = [p.id, lotNo ?? '', refurbished ? 'R' : 'N', unitCostPaise ?? ''].join('|');
    const existing = merged.get(key);
    const units = mode === 'serial' ? (serial ? [serial] : Array.from({ length: qty }, () => null)) : [];

    if (existing) {
      existing.qty += qty;
      existing.units.push(...units);
    } else {
      merged.set(key, {
        productId: p.id, productCode: p.productCode, productName: p.productName, trackingMode: mode,
        qty, units, lotNo, expiryDate, unitCostPaise, refurbished,
      });
    }
  });

  if (rows.length === 0) errors.push({ row: 1, reason: 'The file has no rows under its header.' });

  return { lines: [...merged.values()], errors };
}
