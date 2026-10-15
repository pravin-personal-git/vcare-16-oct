import { requireContext } from '@/server/context';
import { technicianReport } from '@/server/technician-performance';
import { teamActivityReport } from '@/server/team-activity';
import { visibleComplaintFilter } from '@/server/complaint-visibility';
import { resolveRange } from '@/lib/date-ranges';
import { TechniciansClient } from './TechniciansClient';

/**
 * TEAM PERFORMANCE (HRM). Two halves, because one of them was the whole
 * screen until today.
 *
 * FIELD JOBS (F-02, 6 Oct 2026) - per technician: jobs assigned / accepted /
 * closed / open, time to accept, reach, on site and close, missed deadlines,
 * reopened jobs, how jobs were signed off, rating, parts issued, km travelled.
 *
 * EVERYTHING ELSE (wave 4, 8 Oct 2026) - Pravin asked for Team Performance in
 * HRM measuring every action. Every figure in the half above comes off a
 * complaint, so a salesperson with forty quotations and a coordinator with
 * ninety calls both read as blank. `server/team-activity` adds up what Atlas
 * already records for everybody: calls, leads, quotations, orders, invoices,
 * tasks, visits and attendance.
 *
 * Someone who may see only their own jobs ("Complaints they see") sees only
 * their own line, in both halves.
 */
export default async function TechniciansPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const range = resolveRange(sp, 'this_month');
  const from = range.from ?? new Date('2020-01-01T00:00:00+05:30');
  const to = range.to ?? new Date();

  const limited = await visibleComplaintFilter(ctx);
  const [report, activity] = await Promise.all([
    technicianReport(
      ctx.scope, ctx.stores.map((s) => s.id), from, to,
      limited ? (uid) => uid === ctx.user.id : null,
    ),
    teamActivityReport(ctx.scope, from, to, limited ? ctx.user.id : null),
  ]);

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <TechniciansClient
      rows={report.rows}
      jobs={Object.fromEntries(Object.entries(report.jobs).map(([uid, js]) => [uid, js.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(), assignedAt: iso(j.assignedAt), acceptedAt: iso(j.acceptedAt),
        firstOnSiteAt: iso(j.firstOnSiteAt), resolvedAt: iso(j.resolvedAt), closedAt: iso(j.closedAt),
      }))]))}
      activity={activity.rows}
      range={range.preset}
      rangeLabel={range.label}
      onlyMine={!!limited}
    />
  );
}
