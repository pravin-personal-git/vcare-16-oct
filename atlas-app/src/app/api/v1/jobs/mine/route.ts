import { field } from '@/server/auth/v1-staff';
import { myWork } from '@/server/field-jobs';

/**
 * The technician's simple app (13 Oct 2026): their complaints and
 * installation jobs in ONE list, and their visits for today and tomorrow -
 * see server/field-jobs and lib/my-work. Complaints need the Complaints
 * section and permission; installations their own (as on the older screens),
 * so a role without one simply gets the other.
 */
export async function GET(req: Request) {
  return field(req, ['complaints.view', 'complaints.edit', 'orders.view', 'orders.edit'], null, async (ctx, access) => {
    const withComplaints = access.sections.complaints && (ctx.permissions.has('complaints.view') || ctx.permissions.has('complaints.edit'));
    const withInstallations = access.sections.installations && (ctx.permissions.has('orders.view') || ctx.permissions.has('orders.edit'));
    const out = await myWork(ctx.scope, ctx.user.id, { withComplaints, withInstallations });
    return { ...out, canEdit: ctx.permissions.has('complaints.edit') || ctx.permissions.has('orders.edit') };
  });
}
