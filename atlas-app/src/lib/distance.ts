import { metresBetween, type Fix } from './shift';

/**
 * HOW FAR SOMEBODY ACTUALLY TRAVELLED (F1c, PAPER-TRAIL-AND-DISTANCE-SPEC §B).
 *
 * THE METHOD IS THE FEATURE, NOT A DETAIL.
 *
 * `pathMetres` in lib/shift.ts already sums the gaps between consecutive
 * fixes, and its own comment calls it "a floor, not a total". Summed over a
 * day of breadcrumbs it is not a floor at all - it is far too high. A phone
 * sitting on a desk with ordinary GPS noise jitters by ten or twenty metres
 * every few minutes, and eight hours of that invents several kilometres. The
 * first person who sees "Ramesh: 340 km" stops trusting the number, and then
 * stops trusting the screens around it.
 *
 * So the rule is fixed here, written on the screen next to the figure, and
 * tested:
 *
 *   1. Drop fixes too vague to place - accuracy worse than `accuracyCeilingM`.
 *      A reading good to 500 m cannot tell you about a 200 m trip.
 *   2. Drop simulated fixes entirely, and count them, so a flagged day is
 *      visibly flagged rather than quietly wrong.
 *   3. Ignore a step shorter than the pair's own accuracy. Two fixes each good
 *      to 20 m that differ by 8 m have not established any movement - that is
 *      the noise floor, and it is where the invented kilometres come from.
 *   4. Ignore a step that implies an impossible speed: a GPS jump across town
 *      and back is a bad fix, not a journey.
 *   5. Ignore a step across a long gap in reporting. The phone was off or out
 *      of signal; a straight line between the two ends is a guess, and a guess
 *      that large should not be added silently.
 *
 * Everything dropped is counted, so the caller can say how confident the
 * figure is instead of presenting it flat.
 *
 * The result is deliberately an UNDER-count. Given the choice, a distance that
 * is a little short is recoverable - somebody asks and you explain the rule -
 * while one that is too long looks like surveillance that cannot count.
 */

export interface TrackPoint extends Fix {
  /** Epoch milliseconds, from the phone's own clock. */
  at: number;
  accuracyM?: number | null;
  mocked?: boolean;
}

export interface DistanceRule {
  /** Fixes vaguer than this are dropped. */
  accuracyCeilingM: number;
  /** A step implying more than this is treated as a bad fix. */
  maxSpeedKmh: number;
  /** A gap longer than this breaks the trail rather than drawing a line across it. */
  maxGapMinutes: number;
}

/**
 * The defaults, chosen for a service business in a city: a technician on a
 * scooter, phone in a pocket, reporting every few minutes.
 *
 * 50 m is roughly what a phone reports indoors or under cover. 120 km/h is
 * above any road speed these journeys involve and well below the jumps a bad
 * fix produces. 15 minutes is longer than the tracker's own interval, so an
 * ordinary run of points is never broken, while a lunch break or a dead zone
 * is.
 */
export const DEFAULT_DISTANCE_RULE: DistanceRule = {
  accuracyCeilingM: 50,
  maxSpeedKmh: 120,
  maxGapMinutes: 15,
};

/** One line of plain English, shown beside the figure so it is never a mystery. */
export function describeRule(rule: DistanceRule = DEFAULT_DISTANCE_RULE): string {
  return `Approximate. Counts movement between readings accurate to ${rule.accuracyCeilingM} m or better, `
    + `ignoring jumps faster than ${rule.maxSpeedKmh} km/h or gaps over ${rule.maxGapMinutes} minutes.`;
}

export interface DistanceResult {
  metres: number;
  /** Points that survived every filter and could be used. */
  usedPoints: number;
  /** Dropped for being too vague to place. */
  droppedInaccurate: number;
  /** Dropped for being simulated. A day with any of these is not trustworthy. */
  droppedMocked: number;
  /** Steps ignored as noise, impossible speed, or a break in reporting. */
  ignoredNoise: number;
  ignoredJumps: number;
  brokenByGaps: number;
}

export const EMPTY_DISTANCE: DistanceResult = {
  metres: 0, usedPoints: 0, droppedInaccurate: 0, droppedMocked: 0,
  ignoredNoise: 0, ignoredJumps: 0, brokenByGaps: 0,
};

/**
 * Distance across one ordered run of fixes - one shift, normally.
 *
 * Points need not arrive sorted: a phone that queued points offline can send
 * them out of order, and sorting here rather than trusting the caller means a
 * late batch cannot silently produce a zig-zag that doubles the total.
 */
export function distanceOf(
  points: TrackPoint[],
  rule: DistanceRule = DEFAULT_DISTANCE_RULE,
): DistanceResult {
  const out: DistanceResult = { ...EMPTY_DISTANCE };
  if (points.length === 0) return out;

  const usable: TrackPoint[] = [];
  for (const p of points) {
    if (p.mocked) { out.droppedMocked += 1; continue; }
    if (p.accuracyM != null && p.accuracyM > rule.accuracyCeilingM) { out.droppedInaccurate += 1; continue; }
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.at)) continue;
    usable.push(p);
  }

  usable.sort((a, b) => a.at - b.at);
  out.usedPoints = usable.length;
  if (usable.length < 2) return out;

  const maxGapMs = rule.maxGapMinutes * 60_000;

  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1];
    const b = usable[i];
    const gapMs = b.at - a.at;

    if (gapMs > maxGapMs) { out.brokenByGaps += 1; continue; }

    const step = metresBetween(a, b);

    /**
     * The noise floor: a step no bigger than what the two readings could be
     * wrong by has not established movement. This is where a phone on a desk
     * turns into several kilometres a day.
     *
     * The slack is the SUM of the two accuracies, not the larger of them. Each
     * fix can be wrong by its own radius in any direction, so two readings of
     * a stationary phone, each good to 10 m, can legitimately sit 20 m apart.
     * Taking the larger was the first rule here and it leaked: a desk test
     * with ±6 m of jitter on 10 m fixes still scored 11 m.
     */
    const slack = (a.accuracyM ?? 0) + (b.accuracyM ?? 0);
    if (step <= slack) { out.ignoredNoise += 1; continue; }

    // Two fixes at the same instant cannot be checked for speed. Treat them as
    // a jump rather than dividing by zero.
    if (gapMs <= 0) { out.ignoredJumps += 1; continue; }

    const kmh = (step / 1000) / (gapMs / 3_600_000);
    if (kmh > rule.maxSpeedKmh) { out.ignoredJumps += 1; continue; }

    out.metres += step;
  }

  return out;
}

/** Add up several runs - a month of shifts, say. */
export function sumDistances(parts: DistanceResult[]): DistanceResult {
  return parts.reduce<DistanceResult>((acc, p) => ({
    metres: acc.metres + p.metres,
    usedPoints: acc.usedPoints + p.usedPoints,
    droppedInaccurate: acc.droppedInaccurate + p.droppedInaccurate,
    droppedMocked: acc.droppedMocked + p.droppedMocked,
    ignoredNoise: acc.ignoredNoise + p.ignoredNoise,
    ignoredJumps: acc.ignoredJumps + p.ignoredJumps,
    brokenByGaps: acc.brokenByGaps + p.brokenByGaps,
  }), { ...EMPTY_DISTANCE });
}

/**
 * "12.4 km", "840 m", or "-" for nothing usable.
 *
 * Null is NOT zero and never prints as it. "0 km" says somebody went nowhere;
 * a person whose tracking is off, or who has fewer than two usable fixes, is a
 * different statement and gets "Not tracked" from the caller.
 */
export function formatDistance(metres: number | null): string {
  if (metres === null) return '-';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** True when the figure rests on so little that it should be shown as unreliable. */
export function isThin(r: DistanceResult): boolean {
  return r.usedPoints < 2 || r.droppedMocked > 0;
}
