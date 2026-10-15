import { field } from '@/server/auth/v1-staff';
import { technicianInstallations } from '@/server/field-app';

/**
 * Fittings this technician is on.
 *
 * Its own list, not a filter on complaints (Pravin's point 3). A complaint is
 * something that broke; an installation is work that was sold, and sharing one
 * list made somebody read past four repairs to find the job they were standing
 * outside.
 *
 * `?all=1` widens to the branch for whoever is allowed the branch scope on
 * complaints — the same authority, because seeing other people's work is one
 * decision, not two.
 */
export async function GET(req: Request) {
  return field(req, ['orders.view', 'orders.edit'], 'installations', async (ctx, access) => {
    const all = access.scope.complaints === 'branch'
      && new URL(req.url).searchParams.get('all') === '1';
    const rows = await technicianInstallations(ctx.scope, ctx.user.id, { all });
    return {
      installations: rows,
      canEdit: ctx.permissions.has('orders.edit'),
      scope: all ? 'branch' : 'mine',
    };
  });
}
