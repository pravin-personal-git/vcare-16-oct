import { jsonBody, staff, str, V1Error } from '@/server/auth/v1-staff';
import { assignTechnician, listTechnicians } from '@/server/complaints';
import { setInstallationTeam } from '@/server/installation-page';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';

/**
 * Assign from the owner's phone (13 Oct 2026). Same functions as the
 * website's Assign: a complaint gets one technician (Complaints: edit); an
 * installation gets its team (Installations: edit, as the website's team box).
 * The person must be one the website would offer (active, in this branch) -
 * checked here, as assignTechnician trusts its caller.
 *
 * Body: { complaintId, technicianId } (1.0.19) or { kind, id, technicianIds } (1.0.21+).
 */
export async function POST(req: Request) {
  return staff(req, ['complaints.edit', 'installations.edit'], async (ctx) => {
    const b = await jsonBody(req);
    const kind = b.kind === 'installation' ? 'installation' : 'complaint';
    const id = str(b.id, 40) ?? str(b.complaintId, 40);
    const ids = Array.isArray(b.technicianIds)
      ? b.technicianIds.filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [str(b.technicianId, 40)].filter((x): x is string => !!x);
    if (!id) throw new V1Error('Choose a job.');
    const people = await listTechnicians(ctx.scope);
    if (ids.some((t) => !people.some((p) => p.id === t))) throw new V1Error('That person cannot be given jobs in this branch.');

    if (kind === 'installation') {
      if (!ctx.permissions.has('installations.edit')) throw new V1Error('You cannot change an installation team.', 403);
      const ch = await db.installationChallan.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { priority: true } });
      if (!ch) throw new V1Error('That installation is not in this branch.', 404);
      await setInstallationTeam(ctx.scope, id, { assigneeIds: ids, priority: ch.priority }, ctx.user.id);
      return { ok: true, message: ids.length ? 'Team set.' : 'Team cleared.' };
    }
    if (!ctx.permissions.has('complaints.edit')) throw new V1Error('You cannot assign complaints.', 403);
    if (ids.length !== 1) throw new V1Error('Choose one technician.');
    await assignTechnician(ctx.scope, id, ids[0]!, ctx.user.id);
    return { ok: true, message: 'Assigned.' };
  });
}
