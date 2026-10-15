import 'server-only';
import type { AppContext } from './context';
import { attendanceSummary, listShifts, type ShiftRow } from './shifts';
import { istDate } from '@/lib/date-ranges';
import { daysToRange, parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Shift Log, filtered - shared by the screen and its export (F1).
 * Shift date defaults to the last 7 days (as the screen always did); old
 * ?days= and ?user= links keep working. ?problems=1 = shifts that never
 * ended (closed automatically).
 */

type Sp = Record<string, string | undefined>;

export const SHIFT_GRID: PageOptions<ShiftRow> = {
  search: (s) => [s.userName, s.note, s.correctionReason],
  sort: {
    date: (s) => s.startedAt, who: (s) => s.userName, source: (s) => s.source, in: (s) => s.startedAt, out: (s) => s.endedAt,
    worked: (s) => s.workedMinutes, calls: (s) => s.callCount, overtime: (s) => s.overtimeMinutes, where: (s) => (s.startLat === null ? 0 : 1),
  },
};

export async function shiftsList(ctx: AppContext, rawSp: Sp) {
  const sp = daysToRange(rawSp, istDate);
  const filters = parseListFilters({ ...sp, person: sp.person ?? sp.user }, { defaultRange: 'all', meId: ctx.user.id });
  const problems = sp.problems === '1';
  const from = filters.range.from ?? new Date(0);
  const to = filters.range.to ? new Date(filters.range.to.getTime() - 1) : new Date();

  const [summary, shifts] = await Promise.all([
    attendanceSummary(ctx.scope, from, to),
    listShifts(ctx.scope, { from, to, userId: filters.personId ?? undefined }),
  ]);
  const query = parseGridQuery(sp);
  const rows = searchAndSort(problems ? shifts.filter((s) => s.autoClosed) : shifts,
    { q: query.q, sort: query.sort ?? { key: 'date', dir: 'desc' } }, SHIFT_GRID);
  return { rows, summary, filters, problems, openNow: shifts.filter((s) => !s.endedAt).length };
}
