import 'server-only';
import type { AppContext } from './context';
import { listInstallationChallans, type InstallationChallanRow } from './installation-challans';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Installation Challans, filtered - shared by the screen and its export (F1).
 * A work queue: challan date defaults to all time. Used to filter all 906
 * Vcare challans in the browser; now the server sends one page.
 */

type Sp = Record<string, string | undefined>;

export const INSTALLATION_STATUSES = ['pending', 'work_done', 'approved', 'rejected', 'legacy_unknown'] as const;

export const INSTALLATION_GRID: PageOptions<InstallationChallanRow> = {
  search: (c) => [c.challanNo, c.legacyRef, c.orderNo, c.customerName, c.physicalChallanNo, c.technicianRemark, ...c.assignees],
  sort: { dispatchedAt: (c) => c.dispatchedAt, challanNo: (c) => c.challanNo, customerName: (c) => c.customerName },
};

export async function installationsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const status = (INSTALLATION_STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : null;

  const all = await listInstallationChallans(ctx.scope);
  const technicians = [...new Map(all.flatMap((c) => c.assigneeIds.map((id, i) => [id, c.assignees[i] ?? ''] as const))).entries()]
    .filter(([, n]) => n).map(([id, fullName]) => ({ id, fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const inScope = all.filter((c) => inRange(c.dispatchedAt, filters.range) && (!filters.personId || c.assigneeIds.includes(filters.personId)));
  const counts = Object.fromEntries(INSTALLATION_STATUSES.map((s) => [s, inScope.filter((c) => c.status === s).length])) as Record<string, number>;
  // Newest first unless the viewer sorts otherwise - the slip just signed is the one being looked for.
  const query = parseGridQuery(sp);
  const rows = searchAndSort(status ? inScope.filter((c) => c.status === status) : inScope,
    { q: query.q, sort: query.sort ?? { key: 'dispatchedAt', dir: 'desc' } }, INSTALLATION_GRID);

  return { rows, counts, status, filters, technicians, totalAll: all.length };
}
