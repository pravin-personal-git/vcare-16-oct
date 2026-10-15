import 'server-only';
import type { AppContext } from './context';
import { listServiceVisits, type ServiceVisitRow } from './complaints';
import { inRange } from '@/lib/date-ranges';
import { visitReasonLabel, VISIT_REASON_KEYS } from '@/lib/visit-reasons';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Visit Scheduler, filtered - shared by the screen and its export (F1).
 *
 * Opens on today (7 Oct 2026, Pravin's call for every list), filtered by
 * technician on request; a coordinator schedules for everyone, so the default
 * person stays "everyone" and "Assigned to me" is one click.
 *
 * `kind` narrows to new installations or to complaints, which is the split
 * that matters now that a visit can be either. It is deliberately separate
 * from `reason`: "show me the installations" is one question and "show me the
 * surveys" is another, and answering the first should not need knowing which
 * three reasons happen to be installation reasons.
 */

type Sp = Record<string, string | undefined>;
export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;

export const VISIT_GRID: PageOptions<ServiceVisitRow> = {
  search: (v) => [v.docNo, v.customerName, v.technicianName, v.outcomeNote, v.purpose, visitReasonLabel(v.reason)],
  sort: { scheduledAt: (v) => v.scheduledAt },
};

export async function visitsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const status = (VISIT_STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : null;
  const kind = sp.kind === 'installation' || sp.kind === 'complaint' ? sp.kind : null;
  const reason = VISIT_REASON_KEYS.includes(sp.reason ?? '') ? sp.reason! : null;
  const all = await listServiceVisits(ctx.scope);
  const inScope = all.filter((v) => inRange(v.scheduledAt, filters.range)
    && (!filters.personId || v.technicianId === filters.personId)
    && (!kind || v.subject === kind)
    && (!reason || v.reason === reason));
  const counts = Object.fromEntries(VISIT_STATUSES.map((s) => [s, inScope.filter((v) => v.status === s).length])) as Record<string, number>;
  // Counted on what the other filters already narrowed, so the two chips
  // agree with the list rather than with the whole table.
  const kindCounts = {
    installation: inScope.filter((v) => v.subject === 'installation').length,
    complaint: inScope.filter((v) => v.subject === 'complaint').length,
  };
  const query = parseGridQuery(sp);
  const rows = searchAndSort(status ? inScope.filter((v) => v.status === status) : inScope,
    { q: query.q, sort: query.sort ?? { key: 'scheduledAt', dir: 'desc' } }, VISIT_GRID);
  return { rows, counts, kindCounts, status, kind, reason, filters, totalAll: all.length };
}
