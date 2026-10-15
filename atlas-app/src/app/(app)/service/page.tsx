import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listCalls } from '@/server/call-logs';
import { ServiceCallsClient } from './ServiceCallsClient';
import { serviceDepartments } from '@/server/service-team';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { pageOf, parseGridQuery } from '@/lib/server-grid';

/**
 * Service calls - the same pipeline as sales calls, filtered by department.
 *
 * NOTHING NEW IS CAPTURED HERE, AND THAT IS THE POINT.
 *
 * A service engineer's phone is already paired and already reporting. The only
 * difference between a "sales call" and a "service call" is which team the
 * person making it belongs to. So this screen is one filter over data that
 * already exists - not a second pipeline, not a second app on the engineer's
 * phone, and not a second thing that can break.
 *
 * Which departments count as service is configurable, because "Service" is
 * called different things in different companies - Support, Field, AMC. Any
 * department whose name contains one of those words is included by default,
 * and the screen says which so nobody has to guess.
 */


const DEFAULT_DAYS = 7;

export default async function ServiceCallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  // Call Logs is the one home for calls (27 Sep 2026): the menu's "Service
  // Team Calls" opens its service-team view. This page stays for choosing
  // which departments are the service team (?setup=1, linked from there).
  if (!sp.setup && !sp.dept && !sp.days) redirect('/call-logs?team=service');

  const days = Math.min(90, Math.max(1, Number(sp.days) || DEFAULT_DAYS));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  // Chosen by the admin below, or guessed from department names until then (CALL-6).
  const team = await serviceDepartments(ctx.scope);
  const departments = team.departments;
  const serviceDepts = sp.dept
    ? departments.filter((d) => d.id === sp.dept)
    : departments.filter((d) => team.serviceIds.includes(d.id));

  // Users are ORG-level, not store-level - they reach a store through a role,
  // which is why this is `storeRoles: { some: ... }` and not `scopeWhere`. The
  // same pattern `call-logs.ts` uses when it checks a user belongs to a store.
  //
  // In All Company there is no single store to match on, so the department
  // filter carries the scoping by itself: departments ARE store-scoped, so a
  // user in one of them is in one of your stores by construction.
  const staff = await db.user.findMany({
    where: {
      isActive: true,
      departmentId: { in: serviceDepts.map((d) => d.id) },
      ...(ctx.scope.kind === 'all'
        ? {}
        : { storeRoles: { some: { storeId: ctx.scope.storeId } } }),
    },
    select: { id: true, fullName: true, department: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
  });

  // An empty staff list must produce an empty screen, not the whole company -
  // `listCalls` treats `userIds: []` as "match nothing", deliberately.
  const calls = await listCalls(ctx.scope, {
    userIds: staff.map((s) => s.id),
    from,
    to,
    take: LIST_MAX_ROWS,
  });

  // F1b server paging (6 Oct 2026): tiles count every call; search, sort and
  // the page run here, and one page is sent.
  const totals = {
    count: calls.length,
    incoming: calls.filter((c) => c.direction === 'incoming').length,
    talk: calls.reduce((n, c) => n + c.durationSec, 0),
    customers: new Set(calls.filter((c) => c.partyId).map((c) => c.partyId)).size,
  };
  const page = pageOf(calls, parseGridQuery(sp), {
    search: (c) => [c.userName, c.e164Number, c.rawNumber, c.partyName, c.direction],
    sort: {
      when: (c) => c.startedAt, who: (c) => c.userName, number: (c) => c.e164Number,
      direction: (c) => c.direction, duration: (c) => c.durationSec,
    },
  });

  return (
    <ServiceCallsClient
      paging={page.paging}
      totals={totals}
      days={days}
      activeDept={sp.dept ?? null}
      departments={departments}
      serviceDeptNames={serviceDepts.map((d) => d.name)}
      serviceDeptIds={team.serviceIds}
      chosen={team.chosen}
      canConfigure={ctx.scope.kind === 'single' && ctx.permissions.has('settings.edit')}
      needsBranch={ctx.scope.kind === 'all' && ctx.permissions.has('settings.edit')}
      staff={staff.map((s) => ({
        id: s.id,
        name: s.fullName,
        departmentName: s.department?.name ?? null,
      }))}
      calls={page.rows.map((c) => ({
        id: c.id,
        userId: c.userId,
        userName: c.userName,
        rawNumber: c.rawNumber,
        e164Number: c.e164Number,
        direction: c.direction,
        startedAt: c.startedAt.toISOString(),
        durationSec: c.durationSec,
        matchedCrm: c.matchedCrm,
        partyId: c.partyId,
        partyName: c.partyName,
      }))}
    />
  );
}
