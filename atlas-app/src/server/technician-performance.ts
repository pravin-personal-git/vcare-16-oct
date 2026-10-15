import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { getJobSettings } from './job-settings';
import { distanceForUsers } from './distance';
import { technicianPerformance, type PerfJob, type PerfRow } from '@/lib/technician-performance';

/**
 * Technician Performance (F-02, 6 Oct 2026) - Services > Technician
 * Performance. The jobs of every technician who had one assigned, closed or
 * open in the period, added up by lib/technician-performance.
 *
 * `onlyUserIds` narrows it for someone who may see only their own (or their
 * team's) jobs - the same "Complaints they see" setting the Job Board follows.
 */
export interface TechnicianReport {
  rows: PerfRow[];
  jobs: Record<string, PerfJob[]>;
}

export async function technicianReport(
  scope: StoreScope, storeIds: string[], from: Date, to: Date,
  canSee: ((userId: string) => boolean) | null,
  /** The dashboard tab skips km: reading a month of location points is the slow part. */
  opts: { withKm?: boolean } = {},
): Promise<TechnicianReport> {
  const complaints = await db.complaint.findMany({
    where: {
      ...scopeWhere(scope),
      deletedAt: null,
      assignedTechnicianId: { not: null },
      OR: [
        { assignedAt: { gte: from, lt: to } },
        { assignedAt: null, createdAt: { gte: from, lt: to } },
        { resolvedAt: { gte: from, lt: to } },
        { closedAt: { gte: from, lt: to } },
        { status: { notIn: ['resolved', 'closed', 'cancelled'] } },
      ],
    },
    select: {
      id: true, complaintNo: true, status: true, priority: true, createdAt: true, assignedAt: true,
      acceptedAt: true, resolvedAt: true, closedAt: true, timeOnSiteSec: true, reopenCount: true,
      signOff: true, techRatingStars: true, legacyRef: true, assignedTechnicianId: true, customerId: true,
      customer: { select: { companyName: true, firstName: true, lastName: true } },
      activities: {
        where: { statusTo: 'on_site' }, orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true },
      },
      jobChallans: { where: { deletedAt: null }, select: { lines: { select: { qtyIssued: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const byUser = new Map<string, PerfJob[]>();
  for (const c of complaints) {
    const uid = c.assignedTechnicianId!;
    if (canSee && !canSee(uid)) continue;
    const job: PerfJob = {
      id: c.id, complaintNo: c.complaintNo, customerId: c.customerId, customerName: c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '), status: c.status, priority: c.priority,
      createdAt: c.createdAt, assignedAt: c.assignedAt, acceptedAt: c.acceptedAt,
      firstOnSiteAt: c.activities[0]?.createdAt ?? null,
      resolvedAt: c.resolvedAt, closedAt: c.closedAt, timeOnSiteSec: c.timeOnSiteSec, reopenCount: c.reopenCount,
      signOff: c.signOff, techRatingStars: c.techRatingStars,
      partsIssued: c.jobChallans.reduce((s, ch) => s + ch.lines.reduce((t, l) => t + l.qtyIssued, 0), 0),
      migrated: !!c.legacyRef,
    };
    byUser.set(uid, [...(byUser.get(uid) ?? []), job]);
  }

  const ids = [...byUser.keys()];
  const [users, distances, settings] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }),
    opts.withKm === false
      ? Promise.resolve(new Map<string, { metres: number } | null>())
      : distanceForUsers(scope, ids, storeIds, from, to).catch(() => new Map()),
    getJobSettings(storeIds[0] ?? ''),
  ]);
  const km = new Map<string, number | null>();
  for (const id of ids) {
    const d = distances.get(id);
    km.set(id, d ? Math.round(d.metres / 100) / 10 : null);
  }

  const rows = technicianPerformance(byUser, new Map(users.map((u) => [u.id, u.fullName])), km, settings.sla, from, to);
  return { rows, jobs: Object.fromEntries(byUser) };
}
