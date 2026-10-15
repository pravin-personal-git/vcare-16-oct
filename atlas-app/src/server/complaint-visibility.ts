import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { accessFor } from './app-access';
import { teamIds } from './team-reach';
import { inScope } from '@/lib/app-access';
import type { AppContext } from './context';

/**
 * Which jobs a person may see ON THE WEBSITE (5 Oct 2026).
 *
 * The phone app has always obeyed Settings > Roles > Phone app > "Complaints
 * they see" (mine / mine + unassigned / whole branch). The website ignored it,
 * so a technician signing in on the web saw every job on the board. Same rule
 * now: owners and "whole branch" see everything; everyone else sees jobs
 * assigned to them, jobs with a visit of theirs, and (if allowed) unassigned.
 */
export async function visibleComplaintFilter(ctx: AppContext): Promise<((c: { id: string; assignedTechnicianId: string | null }) => boolean) | null> {
  const access = await accessFor(ctx);
  const mode = access.scope.complaints;
  if (access.isOwner || mode === 'branch') return null;
  // "Mine + my team" (B4): the team's jobs and visits count as the lead's.
  const team = mode === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
  const visits = await db.serviceVisit.findMany({ where: { technicianId: { in: [ctx.user.id, ...(team ?? [])] } }, select: { complaintId: true } });
  const mineByVisit = new Set(visits.map((v) => v.complaintId));
  return (c) => mineByVisit.has(c.id) || inScope(mode, [c.assignedTechnicianId], ctx.user.id, team);
}

/**
 * Leads and tasks on the website follow the same phone-app settings ("Leads
 * they see", "Tasks they see") - G-08, 5 Oct 2026. Until then the website
 * showed the whole branch to anyone who could open the screen. Null = sees
 * everything (owner, or "whole branch").
 */
export async function visibleAssigneeFilter(
  ctx: AppContext, area: 'leads' | 'tasks',
): Promise<((assigneeId: string | null | undefined) => boolean) | null> {
  const access = await accessFor(ctx);
  const mode = access.scope[area];
  // Tasks: "whole branch" also needs the Tasks: edit permission (as the phone app says).
  const wholeBranch = mode === 'branch' && (area !== 'tasks' || ctx.permissions.has('tasks.edit'));
  if (access.isOwner || wholeBranch) return null;
  const effective = mode === 'branch' ? 'mine' : mode;
  // "Mine + my team" (B4 step 2, 11 Oct 2026).
  const team = effective === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
  return (assigneeId) => inScope(effective, [assigneeId], ctx.user.id, team);
}

/**
 * The same "Complaints they see" as a database filter, for counts that are
 * not worked out row by row - the Service dashboard (B4 step 4). Null = the
 * whole branch.
 */
export async function visibleComplaintWhere(ctx: AppContext): Promise<Prisma.ComplaintWhereInput | null> {
  const access = await accessFor(ctx);
  const mode = access.scope.complaints;
  if (access.isOwner || mode === 'branch') return null;
  const team = mode === 'team' ? await teamIds(ctx.scope, ctx.user.id) : new Set<string>();
  const ids = [ctx.user.id, ...team];
  return {
    OR: [
      { assignedTechnicianId: { in: ids } },
      { visits: { some: { technicianId: { in: ids } } } },
      ...(mode === 'mine' ? [] : [{ assignedTechnicianId: null }]),
    ],
  };
}
