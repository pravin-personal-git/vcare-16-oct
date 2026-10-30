import { visibleComplaintFilter } from '@/server/complaint-visibility';
import { requireContext } from '@/server/context';
import { listComplaints } from '@/server/complaints';
import { getJobSettings } from '@/server/job-settings';
import { AutoRefresh } from '@/components/ui/AutoRefresh';
import { officeLabel, type JobStatus } from '@/lib/job-flow';
import { slaChecks, slaWorst } from '@/lib/job-sla';
import { JOB_SETTINGS_DEFAULTS } from '@/lib/job-settings';
import { customisationFor } from '@/server/ui-customisation';
import { BoardClient, type BoardJob } from './BoardClient';

/**
 * Jobs Dashboard (workflow slice 2): every open job in a column for its stage,
 * so the office sees at a glance what waits on whom. Closed and cancelled jobs
 * are not on the board - the Complaints Tracker keeps them.
 *
 * This file does the reading: scope, the technician's own visibility rule, the
 * branch's stage labels and its deadline rules. BoardClient does the showing,
 * because filters and a view switch need to respond without a round trip.
 */
const COLUMNS: { title: string; statuses: JobStatus[] }[] = [
  { title: 'New', statuses: ['received'] },
  { title: 'Waiting for technician', statuses: ['assigned'] },
  { title: 'Accepted / visit booked', statuses: ['accepted', 'scheduled'] },
  { title: 'In the field', statuses: ['on_the_way', 'on_site', 'in_progress', 'awaiting_estimate'] },
  { title: 'Waiting for customer', statuses: ['awaiting_customer'] },
  { title: 'Waiting to close', statuses: ['resolved'] },
];

export default async function JobBoardPage() {
  const ctx = await requireContext();
  const [allJobs, settings, visible, custom] = await Promise.all([
    // Only the stages the board has columns for - closed jobs never show here.
    listComplaints(ctx.scope, { where: { status: { in: COLUMNS.flatMap((c) => c.statuses) } } }),
    ctx.scope.kind === 'single' ? getJobSettings(ctx.scope.storeId) : Promise.resolve(null),
    visibleComplaintFilter(ctx),
    // Stage colours, the overdue rule and columns an admin set (11 Oct 2026).
    customisationFor(ctx, 'services.board'),
  ]);
  // A technician sees only their own jobs, as in the phone app (5 Oct 2026).
  const jobs = visible ? allJobs.filter(visible) : allJobs;
  const labels = settings?.labels ?? null;
  const sla = settings?.sla ?? JOB_SETTINGS_DEFAULTS.sla;
  const now = new Date();

  const open: BoardJob[] = [];
  for (const col of COLUMNS) {
    for (const j of jobs) {
      if (!col.statuses.includes(j.status as JobStatus)) continue;
      open.push({
        id: j.id,
        complaintNo: j.complaintNo,
        customerId: j.customerId,
        customerName: j.customerName,
        productName: j.productName ?? null,
        description: j.description,
        status: j.status,
        // The branch renames its own stages, so resolve the label here where
        // the settings are, not in the browser.
        statusLabel: officeLabel(j.status, labels),
        priority: j.priority,
        assignedTechnicianId: j.assignedTechnicianId ?? null,
        assignedTechnicianName: j.assignedTechnicianName ?? null,
        createdAtMs: j.createdAt.getTime(),
        // Deadline mark on each card (workflow slice 7): the close deadline,
        // from what the list knows; the precise alerts come from the reminder
        // sweep.
        mark: slaWorst(slaChecks({
          status: j.status,
          priority: j.priority,
          createdAt: j.createdAt,
          assignedAt: null,
          arrived: true,
          migrated: !!j.legacyRef,
        }, sla, now)),
        columnTitle: col.title,
      });
    }
  }

  return (
    <div>
      <AutoRefresh />
      <BoardClient
        jobs={open}
        columns={COLUMNS.map((c) => c.title)}
        columnStatus={Object.fromEntries(COLUMNS.map((c) => [c.title, c.statuses[0]]))}
        customise={{ page: 'services.board', initial: custom.value, from: custom.from, canCustomise: custom.canCustomise, roles: custom.roles }}
        /*
          `visible === null` already means "owner, or allowed the whole
          branch" - the same test the board uses to decide whose jobs to
          show. Someone who only sees their own jobs has no use for a
          per-technician filter, so it is not offered.
        */
        canSeeEveryone={visible === null}
      />
    </div>
  );
}
