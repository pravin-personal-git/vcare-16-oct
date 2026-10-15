import { staff } from '@/server/auth/v1-staff';
import { ownerSummary } from '@/server/owner-phone';
import { listTechnicians } from '@/server/complaints';

/**
 * The owner's home on the phone (13 Oct 2026, decision 11 B) - see
 * server/owner-phone. Owner / admin only (settings.edit, the same right that
 * gives them the owner view in the app).
 */
export async function GET(req: Request) {
  return staff(req, 'settings.edit', async (ctx) => {
    const [summary, technicians] = await Promise.all([
      ownerSummary(ctx.scope, ctx.user.id, ctx.permissions),
      listTechnicians(ctx.scope),
    ]);
    return { ...summary, technicians: technicians.map((t) => ({ id: t.id, name: t.fullName })) };
  });
}
