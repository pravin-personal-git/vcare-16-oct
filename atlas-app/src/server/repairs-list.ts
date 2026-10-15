import 'server-only';
import type { AppContext } from './context';
import { listRepairChallans, type RepairChallanRow } from './complaints';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Repair Tracker, filtered - shared by the screen and its export (F1).
 *
 * A work queue: challan date defaults to all time. Person = any of the
 * challan's assignees. Links from before F1 keep working: ?mine=1, ?tech=
 * and a bare ?from= / ?to= (read as a custom range).
 */

type Sp = Record<string, string | undefined>;

export const REPAIR_STATUSES = ['pending', 'work_done', 'approved', 'rejected', 'legacy_unknown'] as const;

export const REPAIR_GRID: PageOptions<RepairChallanRow> = {
  search: (c) => [c.challanNo, c.legacyRef, c.complaintNo, c.customerName, c.productName, c.physicalChallanNo, c.technicianRemark, c.amcContractNo, ...c.assigneeNames],
  sort: {
    challanNo: (c) => c.challanNo, complaintNo: (c) => c.complaintNo, customerName: (c) => c.customerName,
    productName: (c) => c.productName, qty: (c) => c.qty, cost: (c) => c.costPaise, status: (c) => c.status,
    physicalChallanNo: (c) => c.physicalChallanNo, dispatchedAt: (c) => c.dispatchedAt, assignees: (c) => c.assigneeNames.join(', '),
  },
};

export async function repairsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(
    { ...sp, person: sp.person ?? (sp.mine === '1' ? 'me' : sp.tech) },
    { defaultRange: 'all', meId: ctx.user.id },
  );
  const status = (REPAIR_STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : null;

  const all = await listRepairChallans(ctx.scope);
  const technicians = [...new Map(all.flatMap((c) => c.assigneeIds.map((id, i) => [id, c.assigneeNames[i] ?? ''] as const))).entries()]
    .filter(([, name]) => name).map(([id, fullName]) => ({ id, fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const inScope = all.filter((c) => inRange(c.dispatchedAt, filters.range) && (!filters.personId || c.assigneeIds.includes(filters.personId)));
  const counts = Object.fromEntries(REPAIR_STATUSES.map((s) => [s, inScope.filter((c) => c.status === s).length])) as Record<string, number>;
  const rows = searchAndSort(status ? inScope.filter((c) => c.status === status) : inScope, parseGridQuery(sp), REPAIR_GRID);

  return {
    rows, counts, status, filters, technicians,
    totals: { count: all.length, costPaise: all.reduce((n, c) => n + c.costPaise, 0), units: all.reduce((n, c) => n + c.qty, 0) },
  };
}
