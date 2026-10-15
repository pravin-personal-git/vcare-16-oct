import type { AdapterContext, NormalisedPunch, VendorAdapter } from '../contract';
import { directionFromState, parseVendorTime } from '../normalise';

/**
 * A daily CSV or Excel export (F2.5).
 *
 * THE MOST IMPORTANT ADAPTER IN THIS FOLDER, AND THE LEAST IMPRESSIVE.
 *
 * Plenty of attendance vendors will not give an API - either the module is
 * unlicensed, or it is their software running on their server and they have no
 * intention of handing out credentials. Almost all of them will email a daily
 * export, because they already do it for payroll.
 *
 * So when a vendor says "no API", the answer is usually not "then we cannot do
 * this" - it is this file. It is worth building first for exactly that reason,
 * and it is why the client questionnaire lists a daily file as a first-class
 * option rather than a consolation prize.
 *
 * Column names are configured per client, because no two exports agree. The
 * defaults match the most common Indian vendor layouts.
 */

export interface CsvMapping {
  employeeCode: string;
  dateTime: string;
  /** Split date and time columns, where the vendor uses them. */
  date?: string;
  time?: string;
  direction?: string;
  terminal?: string;
  externalId?: string;
}

export const DEFAULT_CSV_MAPPING: CsvMapping = {
  employeeCode: 'employee_code',
  dateTime: 'punch_time',
  direction: 'punch_state',
  terminal: 'terminal_sn',
};

/**
 * A small CSV reader rather than a dependency.
 *
 * Handles quoted fields, embedded commas and doubled quotes, which is all an
 * attendance export ever contains. A full parser would be a package for a
 * problem this file does not have.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);

  if (rows.length === 0) return [];

  // Headers are matched loosely - "Employee Code", "employee_code" and
  // "EmployeeCode" are the same column to everybody except a computer.
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Rows to punches. Exported so a file drop can reuse it without the adapter. */
export function punchesFromRows(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  clockOffsetMinutes = 0,
): NormalisedPunch[] {
  const out: NormalisedPunch[] = [];

  for (const r of rows) {
    const code = (r[norm(mapping.employeeCode)] ?? '').trim();
    if (!code) continue;

    const stamp = mapping.date && mapping.time
      ? `${r[norm(mapping.date)] ?? ''} ${r[norm(mapping.time)] ?? ''}`.trim()
      : (r[norm(mapping.dateTime)] ?? '').trim();
    if (!stamp) continue;

    const at = parseVendorTime(stamp, clockOffsetMinutes);
    if (!at) continue;

    out.push({
      employeeCode: code,
      atUtc: at,
      direction: mapping.direction ? directionFromState(r[norm(mapping.direction)]) : null,
      terminalRef: mapping.terminal ? (r[norm(mapping.terminal)] || null) : null,
      externalId: mapping.externalId ? (r[norm(mapping.externalId)] || null) : null,
      raw: r,
    });
  }

  return out;
}

export const csvFile: VendorAdapter = {
  vendor: 'csv_file',
  label: 'Daily CSV / Excel export',
  transport: 'file',
  hint: 'For vendors who will not give an API but will send a daily file. Usually the quickest route of all.',
  fields: [
    { key: 'employeeCodeColumn', label: 'Employee code column', placeholder: 'employee_code' },
    { key: 'dateTimeColumn', label: 'Date and time column', placeholder: 'punch_time' },
    { key: 'directionColumn', label: 'In/out column (optional)', placeholder: 'punch_state' },
  ],
  capabilities: { health: false, employees: false },

  /**
   * Reads whatever the agent last dropped. `ctx.credentials.content` is the
   * file's text - the agent reads it from the watched folder or the mailbox,
   * because a server on Vercel has neither.
   */
  async fetchPunches(ctx: AdapterContext) {
    const content = ctx.credentials.content ?? '';
    if (!content.trim()) return { punches: [], nextCursor: ctx.cursor, hasMore: false };

    const mapping: CsvMapping = {
      employeeCode: ctx.credentials.employeeCodeColumn || DEFAULT_CSV_MAPPING.employeeCode,
      dateTime: ctx.credentials.dateTimeColumn || DEFAULT_CSV_MAPPING.dateTime,
      direction: ctx.credentials.directionColumn || DEFAULT_CSV_MAPPING.direction,
      terminal: ctx.credentials.terminalColumn || DEFAULT_CSV_MAPPING.terminal,
    };

    const punches = punchesFromRows(parseCsv(content), mapping, ctx.clockOffsetMinutes);
    const newest = punches.reduce<Date | null>(
      (n, p) => (n === null || p.atUtc > n ? p.atUtc : n), null,
    );

    return {
      punches,
      nextCursor: newest ? newest.toISOString() : ctx.cursor,
      hasMore: false,
    };
  },
};
