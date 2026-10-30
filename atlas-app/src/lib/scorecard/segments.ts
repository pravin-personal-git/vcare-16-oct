/**
 * WHO HELD A JOB, AND FOR HOW LONG (31 Oct 2026, scorecard spec "Job ownership
 * and fair credit"). A job that changes hands is split into holder segments;
 * each technician is scored on their own segments with paused time removed.
 * Pure: the server loads the rows, this does the arithmetic (and is tested).
 */

export interface Interval { start: number; end: number }

export interface Segment {
  userId: string;
  start: number;
  end: number;
  /** Why the job came TO this holder (null for the first). */
  reasonIn: string | null;
  /** Why it was taken FROM this holder (null if they still hold it or closed it). */
  reasonOut: string | null;
}

/**
 * Holder changes in time order, each the technician it went to (null = unassigned).
 * `first` is the holder before the first change (from the oldest change's old value),
 * starting at `start`.
 */
export function buildSegments(input: {
  start: number;
  end: number;
  first: string | null;
  changes: { at: number; to: string | null; reason?: string | null }[];
}): Segment[] {
  const out: Segment[] = [];
  let holder = input.first;
  let from = input.start;
  let reasonIn: string | null = null;
  for (const c of [...input.changes].sort((a, b) => a.at - b.at)) {
    if (c.at > input.end) break;
    if (c.to === holder) continue;
    if (holder && c.at > from) out.push({ userId: holder, start: from, end: c.at, reasonIn, reasonOut: c.to ? (c.reason ?? 'unknown') : (c.reason ?? null) });
    holder = c.to; from = Math.max(c.at, input.start); reasonIn = c.reason ?? (c.to ? 'unknown' : null);
  }
  if (holder && input.end > from) out.push({ userId: holder, start: from, end: input.end, reasonIn, reasonOut: null });
  return out;
}

/** Overlapping intervals merged, sorted. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const s = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Milliseconds of [start, end] not covered by any pause. */
export function activeMs(start: number, end: number, pauses: Interval[]): number {
  if (end <= start) return 0;
  let paused = 0;
  for (const p of mergeIntervals(pauses)) {
    const a = Math.max(start, p.start), b = Math.min(end, p.end);
    if (b > a) paused += b - a;
  }
  return end - start - paused;
}

/** Status intervals from a job's status trail: [entered, left) for every status in `statuses`. */
export function statusIntervals(trail: { at: number; to: string | null }[], statuses: readonly string[], end: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const t of [...trail].sort((a, b) => a.at - b.at)) {
    const inside = !!t.to && statuses.includes(t.to);
    if (inside && open === null) open = t.at;
    if (!inside && open !== null) { out.push({ start: open, end: t.at }); open = null; }
  }
  if (open !== null) out.push({ start: open, end });
  return out;
}

/** Median of a list (null when empty). */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
