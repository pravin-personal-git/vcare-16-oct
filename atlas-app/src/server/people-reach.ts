import 'server-only';
import { accessFor } from './app-access';
import { teamIds } from './team-reach';
import type { AppContext } from './context';

/**
 * WHOSE ATTENDANCE AND LEAVE A PERSON SEES (B4 step 4, 12 Oct 2026).
 *
 * From the role's "Attendance and leave they see" (Settings > Roles > Phone
 * app > On the website too): only mine, mine + my team, or the whole branch.
 * Returns the people they may see, or null for no limit (whole branch, or
 * the owner). Every attendance screen, leave on the grid, the People
 * dashboard and the employee page read THIS.
 */
export async function peopleReach(ctx: AppContext): Promise<Set<string> | null> {
  const access = await accessFor(ctx);
  const mode = access.scope.people;
  if (access.isOwner || mode === 'branch') return null;
  const team = mode === 'team' ? await teamIds(ctx.scope, ctx.user.id) : new Set<string>();
  return new Set([ctx.user.id, ...team]);
}

/** Keep the rows of people in reach. */
export function inPeopleReach<R extends { userId: string }>(rows: R[], reach: Set<string> | null): R[] {
  return reach ? rows.filter((r) => reach.has(r.userId)) : rows;
}

/**
 * One person's page (attendance, leave, jobs) outside the viewer's reach:
 * no-access, said plainly. Their own page always opens.
 */
export async function guardPersonPage(ctx: AppContext, userId: string, path: string): Promise<void> {
  if (userId === ctx.user.id) return;
  const reach = await peopleReach(ctx);
  if (reach && !reach.has(userId)) {
    const { redirect } = await import('next/navigation');
    redirect(`/no-access?from=${encodeURIComponent(path)}&reach=people`);
  }
}
