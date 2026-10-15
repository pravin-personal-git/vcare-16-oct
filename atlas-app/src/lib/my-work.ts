/**
 * THE TECHNICIAN'S ONE LIST (13 Oct 2026, simple layout, decisions 1-4).
 *
 * Pravin: "I don't want technicians to see anything other than their
 * complaints and their scheduled visits." So complaints and installation
 * jobs assigned to the person sit in ONE list, each with a small tag, and the
 * only filters are:
 *   Today   - a visit booked for today, or given to them today;
 *   Pending - every open job not done yet, LATE ONES ON TOP IN RED (1).
 * Finished jobs simply leave the list (4). The Schedule screen is the visits,
 * Today then Tomorrow, by time (3).
 *
 * Pure, so the rules are tested without a database. India time throughout:
 * "today" is the technician's day, not the server's (UTC on Vercel).
 */
export type WorkKind = 'complaint' | 'installation';

export interface WorkVisit { id: string; scheduledAt: Date; status: string; checkedInAt: Date | null }

export interface WorkInput {
  kind: WorkKind;
  id: string;
  no: string;
  customerName: string;
  /** `siteLocation` / `customerPhone`: the names the phone redaction knows (lib/app-access redact). */
  siteLocation: string | null;
  problem: string;
  status: string;
  /** Office label for the status or stage, already worded. */
  statusLabel: string;
  priority: string;
  /** When it came to this person (assigned / dispatched), else raised. */
  givenAt: Date;
  /** Their visits on it that are still to happen (not completed / cancelled). */
  visits: WorkVisit[];
  /** A deadline already missed (complaints: the SLA engine). */
  slaMissed?: boolean;
  customerPhone?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface WorkRow extends Omit<WorkInput, 'givenAt' | 'visits'> {
  givenAt: string;
  nextVisitAt: string | null;
  late: boolean;
  /** Why it is late, in words for the card. */
  lateReason: string | null;
  today: boolean;
}

const IST_MS = 330 * 60_000;
export const istDayKey = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/** Grace after a booked time before the visit counts as missed. */
const MISSED_AFTER_MS = 30 * 60_000;

export function workRow(j: WorkInput, now: Date = new Date()): WorkRow {
  const todayKey = istDayKey(now);
  const upcoming = [...j.visits].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  // A visit whose time has passed with nobody on site.
  const missedVisit = upcoming.find((v) => v.scheduledAt.getTime() < now.getTime() - MISSED_AFTER_MS && !v.checkedInAt);
  // An installation is sent out to be fitted that day; still open on a later day is late.
  const installOverdue = j.kind === 'installation' && j.status === 'pending' && upcoming.length === 0
    && istDayKey(j.givenAt) < todayKey;
  const late = !!missedVisit || !!j.slaMissed || installOverdue;
  const lateReason = missedVisit
    ? 'Visit time passed'
    : j.slaMissed ? 'Deadline missed'
      : installOverdue ? 'Not finished on the day' : null;
  const next = upcoming.find((v) => v.scheduledAt.getTime() >= now.getTime() - MISSED_AFTER_MS) ?? upcoming[0] ?? null;
  const today = upcoming.some((v) => istDayKey(v.scheduledAt) === todayKey) || istDayKey(j.givenAt) === todayKey;
  const { givenAt, visits: _visits, ...rest } = j;
  void _visits;
  return { ...rest, givenAt: givenAt.toISOString(), nextVisitAt: next ? next.scheduledAt.toISOString() : null, late, lateReason, today };
}

/** Late first, then by the next visit (soonest first), then urgent before normal, then newest given. */
export function sortWork(rows: WorkRow[]): WorkRow[] {
  const pri = (p: string) => (p === 'urgent' ? 0 : p === 'high' ? 1 : 2);
  return [...rows].sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    const av = a.nextVisitAt ?? '9999', bv = b.nextVisitAt ?? '9999';
    if (av !== bv) return av < bv ? -1 : 1;
    if (pri(a.priority) !== pri(b.priority)) return pri(a.priority) - pri(b.priority);
    return a.givenAt < b.givenAt ? 1 : a.givenAt > b.givenAt ? -1 : 0;
  });
}

export interface ScheduleVisit {
  id: string; kind: WorkKind; jobId: string; no: string; customerName: string; siteLocation: string | null;
  purpose: string; scheduledAt: string; checkedIn: boolean; day: 'earlier' | 'today' | 'tomorrow';
}

/** Which day a visit falls on for the Schedule screen; null = after tomorrow (not shown). */
export function scheduleDay(at: Date, now: Date = new Date()): ScheduleVisit['day'] | null {
  const k = istDayKey(at), today = istDayKey(now), tomorrow = istDayKey(new Date(now.getTime() + 86_400_000));
  if (k < today) return 'earlier';
  if (k === today) return 'today';
  if (k === tomorrow) return 'tomorrow';
  return null;
}
