/**
 * What a dashboard builder sends to the browser. Plain JSON - rupees (not
 * paise), already-written sub-lines, and for every tile the drill-down that
 * opens when it is clicked.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface DrillCol { k: string; l: string; num?: boolean; ink?: 'danger' | 'success' }

/** A button in the drill-down footer or on a row. */
export interface DashAction {
  label: string;
  kind?: 'primary' | 'money' | 'outline' | 'success';
  icon?: string;
  /** Go here. */
  href?: string;
  /** Show this message (things that arrive with a later phase say so). */
  toast?: string;
  /** A client-side action key, handled by the dashboard (approve-all, make-po…). */
  act?: string;
  payload?: unknown;
}

export interface Drill {
  eyebrow?: string;
  title: string;
  sub?: string;
  value?: string;
  delta?: number | null;
  goodUp?: boolean;
  ink?: Tone;
  /** A small chart over the period's buckets. */
  chart?: { label: string; data: number[]; type?: 'bar' | 'area'; fmt?: 'inr' | 'num' };
  moved?: { label: string; v: number; fmt?: 'inr' | 'num' }[];
  rowsTitle?: string;
  rowsTotal?: number;
  cols?: DrillCol[];
  rows?: (Record<string, string | number | null> & { _href?: string })[];
  note?: string;
  route?: string;
  actions?: DashAction[];
}

export interface KpiData {
  id: string;
  label: string;
  icon?: string;
  value: string;
  d: number | null;
  goodUp?: boolean;
  spark?: number[];
  sparkTone?: 'brand';
  sub?: string;
  subTone?: Tone;
  ink?: Tone;
  drill: Drill;
}

export interface Shared {
  /** Chart labels for the period. */
  labels: string[];
  /** Today's bucket, for a "today" marker. */
  rangeLabel: string;
  compareLabel: string | null;
}
