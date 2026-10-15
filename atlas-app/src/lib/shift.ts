/**
 * Shift rules - pure functions, no database, no clock of their own.
 *
 * A shift is two things wearing one coat. To the salesperson it scopes what the
 * app collects, so their evening is visibly their own. To the manager it is
 * attendance: a start, an end and a location, from a phone they already carry.
 *
 * Every function here takes `now` as an argument rather than calling
 * `new Date()`. Auto-close and duration are entirely about elapsed time, and a
 * rule you cannot move the clock on is a rule you cannot test.
 */

/**
 * After this many hours, an open shift is closed by the server.
 *
 * WHY THIS EXISTS AT ALL
 *
 * People forget to press End Shift. Phones die mid-afternoon. Without a
 * ceiling, one forgotten shift stays open for a week and quietly swallows every
 * personal call the employee makes in the evenings - which turns the privacy
 * promise inside out, and does it invisibly. The employee has no idea; the
 * manager sees "calls during work" figures that include a man ringing his
 * mother at 22:40.
 *
 * WHY SIXTEEN AND NOT TWELVE
 *
 * A field salesperson leaving home at 08:00 and finishing dinner with a client
 * at 22:00 has worked a fourteen-hour day. It happens, and a ceiling that cuts
 * an honest long day in half would make the feature wrong for exactly the
 * hardest-working person on the team - the worst possible target. Sixteen is
 * past any real shift and well short of the following morning.
 */
export const SHIFT_MAX_HOURS = 16;

const HOUR_MS = 3_600_000;

export interface ShiftWindow {
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * When a shift's window closes for the purpose of matching calls to it.
 *
 * An open shift is treated as running up to its auto-close deadline, NOT up to
 * `now`. Both readings are defensible in the abstract; this one is the only one
 * that is stable. Using `now` would mean the same call is inside the shift when
 * a report is opened at 15:00 and outside it when the same report is opened at
 * 09:00 the next morning - the row would change its mind, and a figure that
 * changes without the data changing is a figure nobody will believe twice.
 */
export function shiftClosesAt(shift: ShiftWindow): Date {
  if (shift.endedAt) return shift.endedAt;
  return new Date(shift.startedAt.getTime() + SHIFT_MAX_HOURS * HOUR_MS);
}

/** Whether a moment falls inside a shift. Start inclusive, end inclusive. */
export function covers(shift: ShiftWindow, at: Date): boolean {
  const t = at.getTime();
  return t >= shift.startedAt.getTime() && t <= shiftClosesAt(shift).getTime();
}

/**
 * Which of a person's shifts a call belongs to, or null for after-hours.
 *
 * MATCHED BY TIME RANGE, NOT BY "WHICHEVER SHIFT IS OPEN NOW".
 *
 * Calls arrive late as a matter of routine - background sync runs every fifteen
 * minutes, and an OEM that killed the app can delay a batch by days. A call
 * made at 18:50 very often arrives after the 19:03 shift end. Matching against
 * the currently-open shift would file it under the next day's shift, or under
 * nothing at all, and the error would be invisible because the row would still
 * look perfectly reasonable.
 *
 * Shifts should never overlap - `startShift` refuses to open a second one - but
 * if two ever do, the one that started later wins, because that is the one the
 * employee most recently said they were working.
 */
export function shiftForCall<T extends ShiftWindow>(shifts: T[], callAt: Date): T | null {
  let best: T | null = null;
  for (const s of shifts) {
    if (!covers(s, callAt)) continue;
    if (!best || s.startedAt.getTime() > best.startedAt.getTime()) best = s;
  }
  return best;
}

/** Whether an open shift has run past the ceiling and should be closed. */
export function isOverdue(shift: ShiftWindow, now: Date): boolean {
  if (shift.endedAt) return false;
  return now.getTime() - shift.startedAt.getTime() > SHIFT_MAX_HOURS * HOUR_MS;
}

/**
 * Worked minutes.
 *
 * An open shift counts up to `now`, because that is what the employee has
 * worked so far - this is the one place where "now" is the honest answer rather
 * than the unstable one, since nobody expects a running total to hold still.
 *
 * An AUTO-CLOSED shift returns null, not a number. It is unknown, and unknown
 * must not arrive at payroll wearing a plausible sixteen hours.
 *
 * UNLESS A HUMAN HAS SINCE SAID WHAT TIME IT FINISHED. A correction beats the
 * machine's guess, because the machine was guessing and the manager was there.
 * The original `endedAt` is left untouched so both remain visible - see the
 * note on `Shift.correctedEndedAt`.
 */
export function workedMinutes(
  shift: ShiftWindow & { autoClosed?: boolean; correctedEndedAt?: Date | null },
  now: Date,
): number | null {
  if (shift.correctedEndedAt) {
    return Math.max(
      0,
      Math.round((shift.correctedEndedAt.getTime() - shift.startedAt.getTime()) / 60_000),
    );
  }
  if (shift.autoClosed) return null;
  const end = shift.endedAt ? shift.endedAt.getTime() : now.getTime();
  return Math.max(0, Math.round((end - shift.startedAt.getTime()) / 60_000));
}

/**
 * Whether a manager's correction is a sane thing to record.
 *
 * Refuses an end before the start, and refuses one more than
 * `SHIFT_MAX_HOURS` after it - not because a longer day is impossible, but
 * because a typo of the wrong DATE is far more likely than a twenty-hour shift,
 * and a corrected record that is wrong is worse than an uncorrected one that is
 * merely unknown.
 */
export function validateCorrection(
  startedAt: Date,
  correctedEnd: Date,
): string | null {
  if (Number.isNaN(correctedEnd.getTime())) return 'That is not a valid time.';
  if (correctedEnd.getTime() <= startedAt.getTime()) {
    return 'The finish time has to be after the start time.';
  }
  const hours = (correctedEnd.getTime() - startedAt.getTime()) / HOUR_MS;
  if (hours > SHIFT_MAX_HOURS) {
    return `That would be a ${Math.round(hours)}-hour shift. Check the date - `
      + `anything over ${SHIFT_MAX_HOURS} hours is usually a typo.`;
  }
  return null;
}

/**
 * `7h 42m`, `42m`, or the honest shrug for a shift nobody closed.
 *
 * ONLY FOR A SINGLE SHIFT. `null` here means one specific thing - nobody
 * pressed End Shift, so the hours are unknown - and "Not ended" is the right
 * words for exactly that.
 *
 * For a TOTAL across many shifts, use `formatHours`. Null means something
 * different there (nothing recorded yet), and reusing this one produced a
 * summary card reading "Hours recorded: Not ended" on an empty week, which is
 * not a sentence.
 */
export function formatWorked(minutes: number | null): string {
  if (minutes === null) return 'Not ended';
  return formatHours(minutes);
}

/**
 * A duration that is always a duration.
 *
 * For sums and averages, where zero is a real answer and means zero - unlike a
 * single shift, where an absent number means the employee never clocked off.
 */
export function formatHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// ------------------------------------------------------------- time zone

/**
 * The zone the business actually works in.
 *
 * WHY THIS EXISTS AT ALL.
 *
 * `Date.getHours()` answers in the server's zone, and the server runs in UTC.
 * Anything rendered in the browser was fine -- the browser is in Chhattisgarh
 * and formats accordingly -- but anything COMPUTED on the server from
 * `getHours()` was five and a half hours out and looked plausible enough to go
 * unnoticed. "Usual start 18:11" for a team that starts at 23:41 is the shape
 * of that bug: not obviously broken, just quietly wrong.
 *
 * A constant rather than an env var, because a wrong value here produces
 * numbers that still look like times. If this product is ever sold outside
 * India this becomes a per-store setting, and that is a schema change, not a
 * string change.
 */
export const BUSINESS_TZ = 'Asia/Kolkata';

const HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Minutes past midnight, in the business's zone rather than the server's. */
export function minutesPastMidnight(at: Date): number {
  const [h, m] = HHMM.format(at).split(':').map(Number);
  return h * 60 + m;
}

// ------------------------------------------------------------- location

export interface Fix {
  lat: number;
  lng: number;
  accuracyM?: number | null;
}

/**
 * Whether a location fix is precise enough to show without misleading someone.
 *
 * Android will happily hand back a position derived from a single cell tower,
 * accurate to several kilometres. Plotted on a map it looks exactly as
 * confident as a 20-metre GPS fix, and a manager reading "Rahul was at the
 * industrial area" from a 5 km circle is being misinformed by their own
 * software.
 *
 * 2 km is generous on purpose. The question this product answers is "which part
 * of town", not "which building" - being stricter would discard fixes that
 * genuinely answer the question that is actually asked.
 */
export const USABLE_ACCURACY_M = 2000;

export function isUsableFix(fix: Fix): boolean {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
  if (fix.lat < -90 || fix.lat > 90) return false;
  if (fix.lng < -180 || fix.lng > 180) return false;
  // Exactly (0, 0) is in the Atlantic off Ghana. It is null island - what a
  // phone reports when a location object was created and never populated.
  if (fix.lat === 0 && fix.lng === 0) return false;
  if (fix.accuracyM != null && fix.accuracyM > USABLE_ACCURACY_M) return false;
  return true;
}

/**
 * How to describe a fix's precision to somebody who is about to trust it.
 *
 * Deliberately blunt at the bottom end. "Approximate" invites a manager to
 * squint at it anyway; "Too rough to place" tells them not to bother.
 */
export function accuracyLabel(accuracyM: number | null | undefined): string {
  if (accuracyM == null) return 'Accuracy unknown';
  if (accuracyM <= 50) return 'Precise';
  if (accuracyM <= 200) return `Within ${Math.round(accuracyM)} m`;
  if (accuracyM <= USABLE_ACCURACY_M) return `Within ${(accuracyM / 1000).toFixed(1)} km`;
  return 'Too rough to place';
}

/**
 * Metres between two fixes, by the haversine formula.
 *
 * Used for "distance travelled during the shift", which is a rough figure and
 * is presented as one. It is the straight line between consecutive pings, so it
 * under-reports a winding route and over-reports nothing - a floor, not a
 * total, and the UI must say so.
 */
export function metresBetween(a: Fix, b: Fix): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/** Rough distance covered across an ordered run of fixes. A floor, not a total. */
export function pathMetres(fixes: Fix[]): number {
  let total = 0;
  for (let i = 1; i < fixes.length; i++) total += metresBetween(fixes[i - 1], fixes[i]);
  return total;
}
