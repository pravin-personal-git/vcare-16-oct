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
  /** Missed - only where the next move is the technician's (28 Oct 2026). */
  late: boolean;
  /** Why it is late, in words for the card. */
  lateReason: string | null;
  /** A visit of theirs booked for today, or they are on site at it now (28 Oct 2026). */
  today: boolean;
  /**
   * Whose move it is (28 Oct 2026), for the phone's New / Waiting filters:
   * `new` given and not accepted; `waiting` on the customer or the office
   * (estimate, confirmation) - nothing for the technician to do; `working`
   * everything else that is open; `done` finished (search results only).
   */
  stage: WorkStage;
  /** Working at it now - checked in, or the complaint says on site / in progress. */
  onSite: boolean;
}

export type WorkStage = 'new' | 'working' | 'waiting' | 'done';

const NEW_STATUSES = ['received', 'assigned'];
const WAITING_STATUSES = ['awaiting_estimate', 'awaiting_customer'];
const DONE_STATUSES = ['resolved', 'closed', 'cancelled'];

/** Whose move it is, from the job's status. */
export function workStage(kind: WorkKind, status: string): WorkStage {
  if (DONE_STATUSES.includes(status)) return 'done';
  if (NEW_STATUSES.includes(status)) return 'new';
  if (WAITING_STATUSES.includes(status)) return 'waiting';
  return 'working';
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
  const stage = workStage(j.kind, j.status);
  // Installations carry a complaint's statuses since 30 Oct 2026.
  const installOverdue = j.kind === 'installation' && (stage === 'new' || stage === 'working') && upcoming.length === 0
    && istDayKey(j.givenAt) < todayKey;
  const onSite = ['on_site', 'in_progress'].includes(j.status) || upcoming.some((v) => !!v.checkedInAt);
  /*
    Late only where the next move is theirs (28 Oct 2026). A job waiting on
    the customer's estimate approval misses its deadline while it waits; it
    used to turn late and sit on top of Today, burying the work that could
    be done.
  */
  const theirMove = stage === 'new' || stage === 'working';
  const late = theirMove && (!!missedVisit || !!j.slaMissed || installOverdue);
  const lateReason = !late ? null : missedVisit
    ? 'Visit time passed'
    : j.slaMissed ? 'Deadline missed'
      : installOverdue ? 'Not finished on the day' : null;
  const next = upcoming.find((v) => v.scheduledAt.getTime() >= now.getTime() - MISSED_AFTER_MS) ?? upcoming[0] ?? null;
  // Today = where they go today: a visit booked for today, or on site now. Not "given today" - that is New.
  const today = theirMove && (onSite || upcoming.some((v) => istDayKey(v.scheduledAt) === todayKey));
  const { givenAt, visits: _visits, ...rest } = j;
  void _visits;
  return { ...rest, givenAt: givenAt.toISOString(), nextVisitAt: next ? next.scheduledAt.toISOString() : null, late, lateReason, today, stage, onSite };
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
  /** `survey`: a survey booked against the customer alone - jobId is the visit's own id (27 Oct 2026). */
  id: string; kind: WorkKind | 'survey'; jobId: string; no: string; customerName: string; siteLocation: string | null;
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
