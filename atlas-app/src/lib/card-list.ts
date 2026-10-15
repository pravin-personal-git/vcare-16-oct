/**
 * Server paging for card lists (F1b, 6 Oct 2026) - the server half of
 * ListFilter's server mode. The same address keys ListFilter writes: `<key>`
 * for the search box, `<key>_c` for the chip, `<key>_p` for the page. Pure,
 * so it is tested without a database.
 */

import { inRange, resolveRange, stretchRange } from './date-ranges';

type Sp = Record<string, string | string[] | undefined>;

export const CARD_PAGE_SIZE = 50;

export interface CardFilter<T> {
  searchOn: (row: T) => (string | null | undefined)[];
  chipOf?: (row: T) => string;
  /** ListFilter's paramKey - 'q' unless the screen uses another. */
  paramKey?: string;
  /**
   * DATES AND SORT, server side (9 Oct 2026) - the same keys and the same
   * order as the `dates` / `sorts` the screen's ListFilter shows, read from
   * `<key>_d` `<key>_r` `<key>_f` `<key>_t` and `<key>_s`. The FIRST of each is
   * the default (newest first). A key the screen offers but the server does
   * not know is ignored, so a mismatch shows too much rather than too little.
   */
  dates?: { key: string; of: (row: T) => Date | string | null | undefined; future?: boolean }[];
  sorts?: { key: string; compare: (a: T, b: T) => number }[];
}

const one = (sp: Sp, k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ''; };

/** Every row matching the search, chip and date range, in the chosen order - what the export needs too. */
export function filterCards<T>(rows: T[], sp: Sp, f: CardFilter<T>): T[] {
  const key = f.paramKey ?? 'q';
  const q = one(sp, key).trim().toLowerCase().slice(0, 100);
  const chip = one(sp, `${key}_c`);
  const field = f.dates?.find((d) => d.key === one(sp, `${key}_d`)) ?? f.dates?.[0];
  const range = field
    ? stretchRange(resolveRange({ range: one(sp, `${key}_r`), from: one(sp, `${key}_f`), to: one(sp, `${key}_t`) }, 'all'), field.future ?? false)
    : null;
  const matched = rows.filter((r) => {
    if (chip && f.chipOf && f.chipOf(r) !== chip) return false;
    if (field && range && !inRange(field.of(r) ?? null, range)) return false;
    if (!q) return true;
    return f.searchOn(r).some((v) => (v ?? '').toLowerCase().includes(q));
  });
  const sort = f.sorts?.find((s) => s.key === one(sp, `${key}_s`)) ?? f.sorts?.[0];
  return sort ? [...matched].sort(sort.compare) : matched;
}

/** Newest first by a date - the default sort everywhere (Pravin, 9 Oct 2026). Undated rows go last. */
export const newestFirst = <T>(of: (r: T) => Date | string | null | undefined) => (a: T, b: T) =>
  (toMs(of(b)) ?? -Infinity) - (toMs(of(a)) ?? -Infinity);
export const oldestFirst = <T>(of: (r: T) => Date | string | null | undefined) => (a: T, b: T) =>
  (toMs(of(a)) ?? Infinity) - (toMs(of(b)) ?? Infinity);
function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

export interface CardPage<T> {
  rows: T[];
  server: { total: number; matched: number; page: number; pageSize: number };
}

/** Filter, then one page of it. `total` is every row before filtering. */
export function pageCards<T>(rows: T[], sp: Sp, f: CardFilter<T>, pageSize = CARD_PAGE_SIZE): CardPage<T> {
  const key = f.paramKey ?? 'q';
  const matched = filterCards(rows, sp, f);
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(0, Math.floor(Number(one(sp, `${key}_p`)) || 0)), pages - 1);
  return {
    rows: matched.slice(page * pageSize, (page + 1) * pageSize),
    server: { total: rows.length, matched: matched.length, page, pageSize },
  };
}

/** What a card-list screen receives from its page in server mode. */
export interface CardListPage {
  server: CardPage<unknown>['server'];
  /** Chip value -> rows, over everything before the search. */
  chipCounts: Record<string, number>;
  /** Rows before any filter. */
  total: number;
}
