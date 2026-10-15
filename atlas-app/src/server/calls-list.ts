import 'server-only';
import type { AppContext } from './context';
import { listCalls, summaryByEmployee, type CallLogRow } from './call-logs';
import { istDate } from '@/lib/date-ranges';
import { daysToRange, parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { salesTeamUserIds, serviceTeamUserIds } from './service-team';

/**
 * Call logs, filtered - shared by the screen and its export (F1).
 *
 * Call date defaults to the last 7 days (as the screen always did). Links
 * from before F1 keep working: ?days=1|7|30|N and ?user=. People without
 * calls.view only ever see their own calls, whatever the address says.
 * ?type= outgoing | missed narrows the call list (not the per-person table).
 * ?team=service narrows both to the service team (27 Sep 2026) - Call Logs is
 * the one home for calls; "Service Team Calls" in the menu opens this view.
 */

type Sp = Record<string, string | undefined>;

export const CALL_GRID: PageOptions<CallLogRow> = {
  search: (c) => [c.e164Number, c.rawNumber, c.userName, c.partyName, c.direction],
  sort: {
    when: (c) => c.startedAt, who: (c) => c.userName, number: (c) => c.e164Number, direction: (c) => c.direction,
    duration: (c) => c.durationSec, synced: (c) => c.syncedAt,
  },
};

export async function callsList(ctx: AppContext, rawSp: Sp) {
  const sp = daysToRange(rawSp, istDate);
  const seesTeam = ctx.permissions.has('calls.view') || ctx.permissions.has('calls.manage');
  const filters = parseListFilters({ ...sp, person: sp.person ?? sp.user }, { defaultRange: 'all', meId: ctx.user.id });
  const userId = seesTeam ? filters.personId ?? undefined : ctx.user.id;
  const type = sp.type === 'outgoing' || sp.type === 'missed' ? sp.type : null;

  const now = new Date();
  const from = filters.range.from ?? new Date(0);
  // The range end is exclusive; the call query's is inclusive.
  const to = filters.range.to ? new Date(filters.range.to.getTime() - 1) : now;

  /*
    Two teams now, not one (8 Oct 2026). The Sales menu says "Sales Team
    Calls" and Customer Service says "Service Team Calls"; both open this
    screen, and the difference is which half of the branch it counts.

    Someone who may not see other people's calls gets neither - `seesTeam` is
    the same gate it always was.
  */
  const team = seesTeam && (sp.team === 'service' || sp.team === 'sales')
    ? (sp.team as 'service' | 'sales')
    : null;
  const teamIds = team === 'service'
    ? await serviceTeamUserIds(ctx.scope)
    : team === 'sales'
      ? await salesTeamUserIds(ctx.scope)
      : null;

  const [allSummary, calls] = await Promise.all([
    summaryByEmployee(ctx.scope, from, to),
    // A person picked inside the team view narrows it to that person.
    listCalls(ctx.scope, { from, to, userId, userIds: teamIds && !userId ? teamIds : undefined, take: LIST_MAX_ROWS }),
  ]);
  const summary = seesTeam
    ? (teamIds ? allSummary.filter((s) => teamIds.includes(s.userId)) : allSummary)
    : allSummary.filter((s) => s.userId === ctx.user.id);
  const rows = searchAndSort(type ? calls.filter((c) => c.direction === type) : calls,
    { q: parseGridQuery(sp).q, sort: parseGridQuery(sp).sort ?? { key: 'when', dir: 'desc' } }, CALL_GRID);
  return { rows, summary, filters, type, team, seesTeam, activeUserId: seesTeam ? filters.personId : ctx.user.id, capped: calls.length >= LIST_MAX_ROWS };
}
