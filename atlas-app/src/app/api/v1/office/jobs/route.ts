import { staff } from '@/server/auth/v1-staff';
import { officeJobs } from '@/server/office-jobs';

/**
 * The office job board on the phone (13 Oct 2026, native admin app): every
 * open complaint and installation in the branch - server/office-jobs. The
 * same right the website's job board needs (Complaints: view or edit).
 */
export async function GET(req: Request) {
  return staff(req, ['complaints.view', 'complaints.edit'], async (ctx) => ({
    ...(await officeJobs(ctx.scope)),
    canAssign: ctx.permissions.has('complaints.edit'),
  }));
}
