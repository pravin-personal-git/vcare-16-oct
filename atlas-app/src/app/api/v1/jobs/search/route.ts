import { field } from '@/server/auth/v1-staff';
import { searchWork } from '@/server/field-jobs';

/**
 * Search from the technician's My work (28 Oct 2026): ?q= complaint or
 * challan number (new or old), customer, phone or serial; &scope=branch for
 * the whole branch, only when the role's "Complaints they see" is Branch.
 */
export async function GET(req: Request) {
  return field(req, ['complaints.view', 'complaints.edit', 'orders.view', 'orders.edit', 'installations.view', 'installations.edit'], null, async (ctx, access) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').slice(0, 80);
    const canBranch = access.scope.complaints === 'branch';
    const branch = url.searchParams.get('scope') === 'branch' && canBranch;
    const p = ctx.permissions;
    const withComplaints = access.sections.complaints && (p.has('complaints.view') || p.has('complaints.edit'));
    const withInstallations = access.sections.installations && ['orders.view', 'orders.edit', 'installations.view', 'installations.edit'].some((k) => p.has(k));
    const jobs = await searchWork(ctx.scope, ctx.user.id, q, { branch, withComplaints, withInstallations });
    return { jobs, canBranch, branch };
  });
}
