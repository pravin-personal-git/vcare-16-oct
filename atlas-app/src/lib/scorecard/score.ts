import type { Pillar } from './settings';

/**
 * TURNING NUMBERS INTO A SCORE (31 Oct 2026, scorecard spec "How a score is
 * calculated"). Each metric becomes 0-100 by the share of peers this person
 * does better than; pillars average their metrics; the overall is the weighted
 * sum of the pillars that have data. Pure, and tested.
 */

export interface MetricDef {
  key: string;
  pillar: Pillar;
  label: string;
  /** Which way is good. */
  better: 'higher' | 'lower';
  /** How the value reads: 'min' minutes, 'pct' 0-100, 'count', 'rate' per 100, 'stars', 'km'. */
  unit: 'min' | 'pct' | 'count' | 'rate' | 'stars' | 'hours';
  /** Fewer events than this (or the owner's minimum, whichever is lower) = not enough data. */
  minN?: number;
  hint: string;
  source: string;
}

export interface MetricValue { value: number | null; n: number }

/** Fewer peers with data than this, and a metric is not ranked. */
export const MIN_PEERS = 3;

/**
 * 0-100 per person for one metric: the share of the OTHER peers with data this
 * person beats, ties counting half. Null for no data, too few events or too few peers.
 */
export function peerScores(def: MetricDef, values: Map<string, MetricValue>, minEvents: number): Map<string, number | null> {
  const need = Math.min(def.minN ?? minEvents, minEvents);
  const ok = [...values.entries()].filter(([, v]) => v.value !== null && v.n >= need) as [string, { value: number; n: number }][];
  const out = new Map<string, number | null>();
  for (const id of values.keys()) out.set(id, null);
  if (ok.length < MIN_PEERS) return out;
  for (const [id, v] of ok) {
    let wins = 0;
    for (const [other, o] of ok) {
      if (other === id) continue;
      if (o.value === v.value) wins += 0.5;
      else if (def.better === 'higher' ? v.value > o.value : v.value < o.value) wins += 1;
    }
    out.set(id, Math.round((wins / (ok.length - 1)) * 100));
  }
  return out;
}

/** The middle value among peers with enough data - the tick beside every bar. */
export function peerMedian(def: MetricDef, values: Map<string, MetricValue>, minEvents: number): number | null {
  const need = Math.min(def.minN ?? minEvents, minEvents);
  const xs = [...values.values()].filter((v) => v.value !== null && v.n >= need).map((v) => v.value as number).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/** Average of the metric scores that exist; null when none does. */
export function pillarScore(scores: (number | null)[]): number | null {
  const xs = scores.filter((s): s is number => s !== null);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/**
 * Weighted overall over the pillars with data. Null when fewer than two pillars
 * have data (spec: "No overall score below 2 scored pillars").
 */
export function overallScore(pillars: Partial<Record<Pillar, number | null>>, weights: Partial<Record<Pillar, number>>): number | null {
  let sum = 0, w = 0, count = 0;
  for (const [p, s] of Object.entries(pillars) as [Pillar, number | null][]) {
    const wt = weights[p] ?? 0;
    if (s === null || s === undefined || wt <= 0) continue;
    sum += s * wt; w += wt; count += 1;
  }
  return count >= 2 && w > 0 ? Math.round(sum / w) : null;
}

/** Rank among peers by overall (1 = best); people without a score are not ranked. */
export function ranks(overall: Map<string, number | null>): Map<string, number> {
  const scored = [...overall.entries()].filter(([, s]) => s !== null) as [string, number][];
  scored.sort((a, b) => b[1] - a[1]);
  const out = new Map<string, number>();
  scored.forEach(([id, s], i) => out.set(id, i > 0 && scored[i - 1]![1] === s ? out.get(scored[i - 1]![0])! : i + 1));
  return out;
}
