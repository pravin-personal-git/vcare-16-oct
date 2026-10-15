/**
 * Server-side paging for list screens (health check PERF-1, 25 Sep 2026).
 *
 * The screens used to send every row in scope - up to 20,000 - to the browser
 * and filter there. Big pages then took seconds to arrive and to wake up, and
 * every click waited behind that work (the "input delay" in Vercel's report).
 * Now a page keeps its query and its filters, runs them ON THE SERVER, and
 * sends only the rows on screen: `pageOf` searches, sorts and slices, and
 * DataGrid's `server` mode drives it through the address (?q= &page= &size=
 * &sort= &dir=). Pure, so it is tested without a database.
 */
import { plainDocNo } from './wa-message';

export interface GridQuery {
  q: string;
  page: number;
  pageSize: number;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
}

export const GRID_SIZES = [25, 50, 100, 250] as const;

export function parseGridQuery(sp: Record<string, string | string[] | undefined>, defaultSize = 50): GridQuery {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const size = Number(one('size'));
  const dir = one('dir') === 'desc' ? 'desc' : 'asc';
  const key = one('sort');
  return {
    // A number copied out of WhatsApp carries non-breaking hyphens (lib/wa-message).
    q: plainDocNo(one('q') ?? '').trim().slice(0, 100),
    page: Math.max(0, Math.floor(Number(one('page')) || 0)),
    pageSize: (GRID_SIZES as readonly number[]).includes(size) ? size : defaultSize,
    sort: key ? { key, dir } : null,
  };
}

type Val = string | number | boolean | Date | null | undefined;

export interface PageOptions<T> {
  /** Values the search box matches (case-insensitive, substring). */
  search: (row: T) => Val[];
  /** Sort accessors by column key - the same keys the page's DataGrid columns use. */
  sort?: Record<string, (row: T) => Val>;
}

const norm = (v: Val): string | number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
};

export function pageOf<T>(rows: T[], query: GridQuery, opts: PageOptions<T>) {
  const out = searchAndSort(rows, query, opts);
  const total = out.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount - 1);
  return {
    rows: out.slice(page * query.pageSize, (page + 1) * query.pageSize),
    total,
    paging: { total, page, pageSize: query.pageSize, sort: query.sort },
  };
}

/**
 * Search and sort without slicing to a page - what an export needs, so the file
 * holds exactly the rows the screen would show across all its pages.
 */
export function searchAndSort<T>(rows: T[], query: Pick<GridQuery, 'q' | 'sort'>, opts: PageOptions<T>): T[] {
  const q = query.q.toLowerCase();
  let out = q
    ? rows.filter((r) => opts.search(r).some((v) => v !== null && v !== undefined && String(v instanceof Date ? v.toISOString() : v).toLowerCase().includes(q)))
    : rows;
  const acc = query.sort && opts.sort?.[query.sort.key];
  if (query.sort && acc) {
    const dir = query.sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = norm(acc(a));
      const bv = norm(acc(b));
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return out;
}

/**
 * One page of rows that were already filtered, searched and sorted - the last
 * step on every F1 list page (the list function does the rest, so its export
 * gets the same rows without the slice).
 */
export function slicePage<T>(rows: T[], query: GridQuery) {
  const pageCount = Math.max(1, Math.ceil(rows.length / query.pageSize));
  const page = Math.min(query.page, pageCount - 1);
  return {
    rows: rows.slice(page * query.pageSize, (page + 1) * query.pageSize),
    paging: { total: rows.length, page, pageSize: query.pageSize, sort: query.sort },
  };
}
