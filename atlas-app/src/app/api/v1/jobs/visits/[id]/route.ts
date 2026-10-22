import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { visitDetail } from '@/server/field-app';
import { rescheduleVisit } from '@/server/complaints';
import { INSTALL_WORK_STAGES, phoneInstallationParts, phoneJobParts } from '@/server/job-challans';

type Params = { params: Promise<{ id: string }> };

/**
 * One visit, with the calls that led to it.
 *
 * The calls are the new part. `CallLog` has synced every phone's call log for
 * weeks and knows a zero-second call means nobody picked up; it has never been
 * shown against the visit it was about, so "did he ring before driving out
 * there?" took two screens and a guess.
 *
 * A visit also carries its job's parts (22 Oct 2026, Vcare): a complaint's, or
 * an installation's material. The technician sends unused parts back from
 * here, through that job's own actions - same checks, same store queue.
 * Older builds ignore the fields.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['complaints.view', 'complaints.edit'], 'complaints', async (ctx, access) => {
    const v = await visitDetail(ctx.scope, id);
    if (!v) throw new V1Error('That visit is not in your scope.', 404);
    const canEdit = ctx.permissions.has('complaints.edit');
    // The same switches as the complaint screen's Parts card, checked here so a
    // role with parts switched off never receives them (Settings > Roles > Phone app).
    const partsOn = canEdit && access.actions['complaints.jobSteps'] !== false
      && (access.layout.preset !== 'simple' || access.layout.job.parts);
    const job = v.complaintId && partsOn
      ? await db.complaint.findUnique({ where: { id: v.complaintId }, select: { storeId: true, status: true } })
      : null;
    const inst = v.installationChallanId && partsOn
      ? await db.installationChallan.findUnique({ where: { id: v.installationChallanId }, select: { storeId: true, stage: true } })
      : null;
    return {
      visit: v,
      canEdit,
      complaintStatus: job?.status ?? null,
      parts: job && v.complaintId ? await phoneJobParts(ctx.scope, v.complaintId, job.storeId, ctx.user.id)
        : inst && v.installationChallanId ? await phoneInstallationParts(ctx.scope, v.installationChallanId, inst.storeId, ctx.user.id)
        : null,
      // Material is asked for while the job is worked on site.
      partsOnSite: job ? job.status === 'on_site' : inst ? (INSTALL_WORK_STAGES as readonly string[]).includes(inst.stage) : false,
    };
  });
}

/**
 * Move a visit.
 *
 * A reason is required and who asked for it is recorded, because the two
 * questions a manager asks about a moved appointment are "why" and "whose
 * idea". `VisitChange` has stored both since it was written; the phone could
 * never write one.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['complaints.edit'], 'complaints', async (ctx) => {
    const b = await jsonBody(req);
    const when = str(b.scheduledAt, 40);
    const reason = str(b.reason, 500);
    if (!when) throw new V1Error('Pick a new date and time.', 400);
    if (!reason) throw new V1Error('Say why it is moving. The customer sees this.', 400);

    const at = new Date(when);
    if (Number.isNaN(at.getTime())) throw new V1Error('That is not a date.', 400);

    await rescheduleVisit(ctx.scope, id, at, reason, ctx.user.id, {
      requestedByCustomer: b.requestedByCustomer === true,
    });
    return { ok: true };
  });
}
