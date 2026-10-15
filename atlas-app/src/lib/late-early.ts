import { istMinuteOfDay } from './ist';
import { parseClock } from './attendance';

/**
 * Late arrival / early departure classification - genuinely new, not a
 * relocation. `DayStatus` (lib/attendance.ts) already has a `late` value,
 * but only as one of ten mutually-exclusive statuses for a day; it never
 * says BY HOW MUCH, and there is no "early departure" concept anywhere in
 * this codebase today (roadmap §4.3). This is the by-how-much answer,
 * built for the dedicated report rather than folded into `dayStatus`
 * itself, which every other attendance screen already depends on.
 */
export interface LateEarlyInput {
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /** `HH:MM` local, from `AttendancePolicy`. */
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
}

export interface LateEarlyResult {
  isLate: boolean;
  lateByMinutes: number;
  isEarlyDeparture: boolean;
  earlyByMinutes: number;
}

// India time, never the server's zone - see lib/ist (the server runs in UTC).
function minutesSinceMidnight(d: Date): number {
  return istMinuteOfDay(d);
}

export function classifyLateEarly(input: LateEarlyInput): LateEarlyResult {
  const shiftStartMinute = parseClock(input.shiftStart);
  const shiftEndMinute = parseClock(input.shiftEnd);
  const lateAfterMinute = shiftStartMinute + input.graceMinutes;

  let isLate = false;
  let lateByMinutes = 0;
  if (input.firstInAt) {
    const arrivedAt = minutesSinceMidnight(input.firstInAt);
    if (arrivedAt > lateAfterMinute) {
      isLate = true;
      lateByMinutes = arrivedAt - shiftStartMinute;
    }
  }

  let isEarlyDeparture = false;
  let earlyByMinutes = 0;
  if (input.lastOutAt) {
    const leftAt = minutesSinceMidnight(input.lastOutAt);
    if (leftAt < shiftEndMinute) {
      isEarlyDeparture = true;
      earlyByMinutes = shiftEndMinute - leftAt;
    }
  }

  return { isLate, lateByMinutes, isEarlyDeparture, earlyByMinutes };
}
