import 'server-only';
import { db } from './db';
import { userInScope, type StoreScope } from './store-scope';

/**
 * Everyone who reports to a person, at any depth - "my team" for data reach
 * (B4, 11 Oct 2026; P2: team = people who report to me, via User.reportsTo).
 * Only people in the branches being looked at; a loop in the reporting line
 * (which Team Setup refuses anyway) cannot spin, as each person is visited
 * once.
 */
export async function teamIds(scope: StoreScope, userId: string): Promise<Set<string>> {
  const team = new Set<string>();
  let frontier = [userId];
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const rows = await db.user.findMany({
      where: { reportsToId: { in: frontier }, ...userInScope(scope) },
      select: { id: true },
    });
    frontier = rows.map((r) => r.id).filter((id) => id !== userId && !team.has(id));
    for (const id of frontier) team.add(id);
  }
  return team;
}
