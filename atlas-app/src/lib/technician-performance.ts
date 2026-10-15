import { SLA_START } from './job-sla';
import type { JobSettingsValue } from './job-settings';

/**
 * Technician work and performance (F-02, 6 Oct 2026).
 *
 * Everything here already existed on the job - when it was assigned,
 * accepted, reached, worked on and closed, how it was signed off, the rating,
 * the parts on its challans - but nothing added it up per person. This is the
 * adding up, kept pure so the arithmetic is tested without a database.
 *
 * Deadlines are judged the way the live SLA engine judges them (lib/job-sla):
 * per priority, only for jobs raised in Atlas after SLA_START and never for
 * migrated ones, so old imported jobs do not all count as "late".
 */

export interface PerfJob {
  id: string;
  complaintNo: string;
  /** The customer, so the name opens their page (G-35). */
  customerId?: string;
  customerName: string;
  status: string;
  priority: string;
  createdAt: Date;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  /** First time the technician marked "on site". */
  firstOnSiteAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  timeOnSiteSec: number;
  reopenCount: number;
  signOff: string | null;
  techRatingStars: number | null;
  /** Units issued on this job's challans. */
  partsIssued: number;
  migrated: boolean;
}

export interface PerfRow {
  userId: string;
  name: string;
  assigned: number;
  accepted: number;
  closed: number;
  openNow: number;
  /** Averages in minutes; null when nothing to average. */
  avgAcceptMin: number | null;
  avgReachMin: number | null;
  avgOnSiteMin: number | null;
  avgCloseMin: number | null;
  slaMissed: number;
  slaTracked: number;
  reopened: number;
  signOff: { otp: number; customer: number; technician: number; office: number };
  avgRating: number | null;
  ratings: number;
  partsIssued: number;
  /** Null = location tracking is off for this person (not zero). */
  km: number | null;
}

const FINISHED = ['resolved', 'closed', 'cancelled'];
const MIN = 60_000;

const mins = (a: Date | null, b: Date | null): number | null =>
  a && b && b.getTime() >= a.getTime() ? (b.getTime() - a.getTime()) / MIN : null;

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};

const doneAt = (j: PerfJob) => j.resolvedAt ?? j.closedAt;

const inWindow = (d: Date | null, from: Date, to: Date) => !!d && d >= from && d < to;

/** Which of the three deadlines this job missed (finished or not). */
export function missedDeadlines(j: PerfJob, sla: JobSettingsValue['sla'], now = new Date()): number {
  if (j.migrated || j.createdAt < SLA_START || j.status === 'cancelled') return 0;
  const p = (sla as Record<string, JobSettingsValue['sla']['normal']>)[j.priority] ?? sla.normal;
  const late = (from: Date | null, at: Date | null, hours: number) => {
    if (!from) return false;
    const due = from.getTime() + hours * 3_600_000;
    return (at ?? now).getTime() > due;
  };
  let n = 0;
  if (late(j.assignedAt, j.acceptedAt, p.accept)) n += 1;
  if (late(j.createdAt, j.firstOnSiteAt, p.visit)) n += 1;
  if (late(j.createdAt, doneAt(j), p.close)) n += 1;
  return n;
}

export function technicianPerformance(
  jobsByUser: Map<string, PerfJob[]>,
  names: Map<string, string>,
  km: Map<string, number | null>,
  sla: JobSettingsValue['sla'],
  from: Date,
  to: Date,
  now = new Date(),
): PerfRow[] {
  const rows: PerfRow[] = [];
  for (const [userId, jobs] of jobsByUser) {
    // Assigned in the period; closed in the period; open right now.
    const assigned = jobs.filter((j) => inWindow(j.assignedAt ?? j.createdAt, from, to));
    const closed = jobs.filter((j) => inWindow(doneAt(j), from, to) && j.status !== 'cancelled');
    const open = jobs.filter((j) => !FINISHED.includes(j.status));
    const tracked = assigned.filter((j) => !j.migrated && j.createdAt >= SLA_START);
    const rated = closed.filter((j) => j.techRatingStars != null);
    const signOff = { otp: 0, customer: 0, technician: 0, office: 0 };
    for (const j of closed) {
      if (j.signOff && j.signOff in signOff) signOff[j.signOff as keyof typeof signOff] += 1;
    }

    rows.push({
      userId,
      name: names.get(userId) ?? 'Unknown',
      assigned: assigned.length,
      accepted: assigned.filter((j) => j.acceptedAt).length,
      closed: closed.length,
      openNow: open.length,
      avgAcceptMin: avg(assigned.map((j) => mins(j.assignedAt, j.acceptedAt))),
      avgReachMin: avg(assigned.map((j) => mins(j.acceptedAt ?? j.assignedAt, j.firstOnSiteAt))),
      avgOnSiteMin: avg(closed.map((j) => (j.timeOnSiteSec > 0 ? j.timeOnSiteSec / 60 : null))),
      avgCloseMin: avg(closed.map((j) => mins(j.createdAt, doneAt(j)))),
      slaMissed: tracked.reduce((n, j) => n + (missedDeadlines(j, sla, now) > 0 ? 1 : 0), 0),
      slaTracked: tracked.length,
      reopened: closed.filter((j) => j.reopenCount > 0).length,
      signOff,
      avgRating: rated.length
        ? Math.round((rated.reduce((s, j) => s + (j.techRatingStars ?? 0), 0) / rated.length) * 10) / 10
        : null,
      ratings: rated.length,
      partsIssued: [...assigned, ...closed.filter((j) => !assigned.includes(j))].reduce((s, j) => s + j.partsIssued, 0),
      km: km.has(userId) ? km.get(userId) ?? null : null,
    });
  }
  return rows.sort((a, b) => b.closed - a.closed || b.assigned - a.assigned || a.name.localeCompare(b.name));
}

/** "2 h 15 m", "3 d 4 h", "-" - for a minutes figure. */
export function minutesLabel(m: number | null): string {
  if (m == null) return '-';
  if (m < 60) return `${m} m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`;
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return `${d} d${h ? ` ${h} h` : ''}`;
}
