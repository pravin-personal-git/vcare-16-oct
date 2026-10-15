import { STAGE_COLORS, STAGE_COLOR_VAR, type StageColor } from './order-stages';

/**
 * PAGE CUSTOMISATION, ADMIN ONLY (11 Oct 2026, ops-pages demo tab 7).
 *
 * One shape for every page that takes it: colours per status value, an
 * "open more than N days -> red row + Overdue" rule, and which columns show
 * in what order. Colours are the eight palette keys the order stages use,
 * rendered through CSS variables - never hex in a component.
 *
 * Pure: the page, the editor and the server all clean through here.
 */

export const PALETTE = STAGE_COLORS;
export type PaletteKey = StageColor;
export const paletteVar = (k: PaletteKey) => STAGE_COLOR_VAR[k];

export interface PageCustomisation {
  /** status value -> palette key, e.g. { in_progress: 'blue' }. */
  colors: Record<string, PaletteKey>;
  /** Open more than this many days -> red row + Overdue badge. Null = off. */
  overdueDays: number | null;
  /** Column keys in the order they show. Missing ones go at the end. */
  order: string[];
  hidden: string[];
}

export const EMPTY_CUSTOMISATION: PageCustomisation = { colors: {}, overdueDays: null, order: [], hidden: [] };

export type CustomiseScope = 'everyone' | 'role' | 'user';

/** The pages that take customisation, and the columns each can show. */
export const CUSTOMISABLE_PAGES = {
  'services.board': {
    label: 'Jobs Dashboard',
    columns: ['job', 'customer', 'what', 'technician', 'stage', 'age'] as const,
  },
} as const;
export type CustomisablePage = keyof typeof CUSTOMISABLE_PAGES;

const KEY = /^[a-z0-9_]{1,40}$/;

export function cleanCustomisation(raw: unknown, page: CustomisablePage): PageCustomisation {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const colors: Record<string, PaletteKey> = {};
  if (o.colors && typeof o.colors === 'object' && !Array.isArray(o.colors)) {
    for (const [k, v] of Object.entries(o.colors as Record<string, unknown>)) {
      if (KEY.test(k) && (PALETTE as readonly string[]).includes(String(v))) colors[k] = v as PaletteKey;
    }
  }
  const days = Number(o.overdueDays);
  const cols = CUSTOMISABLE_PAGES[page].columns as readonly string[];
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String))].filter((c) => cols.includes(c)) : []);
  // The first column is the record's own link - it can move but never hide.
  const hidden = list(o.hidden).filter((c) => c !== cols[0]);
  return {
    colors,
    overdueDays: o.overdueDays === null || o.overdueDays === undefined || o.overdueDays === '' || !Number.isFinite(days) || days < 1
      ? null
      : Math.min(365, Math.round(days)),
    order: list(o.order),
    hidden,
  };
}

/** The columns to draw, in order, without the hidden ones. */
export function visibleColumns<T extends string>(all: readonly T[], c: PageCustomisation): T[] {
  const ordered = [...c.order.filter((k): k is T => (all as readonly string[]).includes(k)), ...all.filter((k) => !c.order.includes(k))];
  return ordered.filter((k) => !c.hidden.includes(k));
}

export const isOverdue = (c: PageCustomisation, openedMs: number, now = Date.now()) =>
  c.overdueDays !== null && now - openedMs > c.overdueDays * 86_400_000;
