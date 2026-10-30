import { field } from '@/server/auth/v1-staff';
import { listComplaints, listServiceVisits } from '@/server/complaints';
import { inScope } from '@/lib/app-access';
import { teamIds } from '@/server/team-reach';

/**
 * A technician's jobs: complaints assigned to them, and their visits that are
 * not done yet. Which complaints they may see is the owner's "Complaints they
 * see" setting (Settings > Roles > Phone app, 26 Sep 2026): mine, mine +
 * unassigned, or the whole branch - `?all=1` widens to the branch only when
 * that is allowed (it used to be open to anyone).
 */
export async function GET(req: Request) {
  return field(req, ['complaints.view', 'complaints.edit'], 'complaints', async (ctx, access) => {
    const scope = access.scope.complaints;
    const all = scope === 'branch' && new URL(req.url).searchParams.get('all') === '1';
    // Done: this person's jobs finished in the last 30 days (phone "Done" tab, 28 Sep 2026).
    const since = Date.now() - 30 * 86_400_000;
    // Only open jobs and this person's recent finished ones leave the database (egress, 30 Oct 2026).
    const [complaints, visits] = await Promise.all([listComplaints(ctx.scope, { where: { OR: [
      { status: { notIn: ['closed', 'cancelled'] } },
      { status: { in: ['closed', 'resolved'] }, assignedTechnicianId: ctx.user.id, OR: [{ closedAt: { gte: new Date(since) } }, { createdAt: { gte: new Date(since) } }] },
    ] } }), listServiceVisits(ctx.scope)]);
    const myVisits = visits.filter((v) => v.technicianId === ctx.user.id && v.status !== 'completed' && v.status !== 'cancelled');
    // "Mine + my team" (B4, 11 Oct 2026) - the same reach as the website.
    const team = scope === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
    const visitComplaints = new Set(visits
      .filter((v) => (v.technicianId === ctx.user.id || !!team?.has(v.technicianId)) && v.status !== 'completed' && v.status !== 'cancelled')
      .map((v) => v.complaintId));
    // Cancelled and closed jobs are off the technician's list (lib/job-flow).
    const open = complaints.filter((c) => c.status !== 'closed' && c.status !== 'cancelled');
    const shown = all ? open : open.filter((c) => visitComplaints.has(c.id)
      || inScope(scope === 'branch' ? 'mine' : scope, [c.assignedTechnicianId], ctx.user.id, team));
    const done = complaints.filter((c) => (c.status === 'closed' || c.status === 'resolved') && c.assignedTechnicianId === ctx.user.id
      && (c.closedAt ?? c.createdAt).getTime() >= since).slice(0, 50);
    return {
      complaints: shown.slice(0, 200),
      done,
      /**
       * `complaintNo` (13 Oct 2026): the phone (1.0.9 - 1.0.18) reads the job
       * number from it, but visits started saying `docNo` when an installation
       * could have one - so every visit row read "undefined - Field visit".
       * Sent under both names; `subject` says which screen an installation
       * visit belongs to.
       */
      visits: myVisits.map((v) => ({ ...v, complaintNo: v.docNo })),
      canEdit: ctx.permissions.has('complaints.edit'),
      scope,
    };
  });
}
