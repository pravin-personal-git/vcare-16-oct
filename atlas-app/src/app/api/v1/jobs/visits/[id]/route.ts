import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { visitDetail } from '@/server/field-app';
import { rescheduleVisit } from '@/server/complaints';

type Params = { params: Promise<{ id: string }> };

/**
 * One visit, with the calls that led to it.
 *
 * The calls are the new part. `CallLog` has synced every phone's call log for
 * weeks and knows a zero-second call means nobody picked up; it has never been
 * shown against the visit it was about, so "did he ring before driving out
 * there?" took two screens and a guess.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['complaints.view', 'complaints.edit'], 'complaints', async (ctx) => {
    const v = await visitDetail(ctx.scope, id);
    if (!v) throw new V1Error('That visit is not in your scope.', 404);
    return { visit: v, canEdit: ctx.permissions.has('complaints.edit') };
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
