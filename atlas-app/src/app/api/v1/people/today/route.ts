import { field } from '@/server/auth/v1-staff';
import { teamToday } from '@/server/team-today';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { istDayStart } from '@/lib/ist';
import { istDay } from '@/lib/renewal-cycle';

/**
 * Who is working today, on the phone (13 Oct 2026, native admin app part 5):
 * the website's Team Today (server/team-today) - on shift, finished, not
 * marked - plus who is on approved leave today. "Attendance and leave they
 * see" applies (server/people-reach), as on the website.
 */
export async function GET(req: Request) {
  return field(req, ['attendance.view'], null, async (ctx) => {
    const [all, reach] = await Promise.all([teamToday(ctx.scope), peopleReach(ctx)]);
    const rows = inPeopleReach(all, reach);
    const start = istDayStart(istDay(new Date()));
    const end = new Date(start.getTime() + 86_400_000 - 1);
    const leave = await db.leaveRequest.findMany({
      where: { ...scopeWhere(ctx.scope), status: 'approved', fromDate: { lte: end }, toDate: { gte: start } },
      select: { userId: true, kind: true, toDate: true, leaveType: { select: { name: true } }, user: { select: { fullName: true } } },
    });
    const onLeave = (reach ? leave.filter((l) => reach.has(l.userId)) : leave)
      .map((l) => ({ userId: l.userId, name: l.user.fullName, type: l.leaveType?.name ?? l.kind, until: l.toDate }));
    const leaveIds = new Set(onLeave.map((l) => l.userId));
    return {
      people: rows.map((r) => ({
        userId: r.userId, name: r.name, status: leaveIds.has(r.userId) && r.status === 'not_marked' ? 'on_leave' : r.status,
        firstInAt: r.firstInAt, lastOutAt: r.lastOutAt, workedMinutes: r.workedMinutes, inWithinPolicy: r.inWithinPolicy,
        source: r.source, phone: r.phone, mockedToday: r.mockedToday,
      })),
      onLeave,
    };
  });
}
