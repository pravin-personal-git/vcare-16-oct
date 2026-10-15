import 'server-only';
import type { UnitRow } from './stock-units';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { inPool, UNIT_POOLS, type UnitPool } from '@/lib/stock-units';
import type { AppContext } from './context';
import { listUnits } from './stock-units';
import { configFor } from './config';

/**
 * Stock units (the Units tab), filtered - shared by the screen and its export
 * (F1). ?pool= a KPI pool (default in stock, 'all' for every unit), arrived
 * date (default all time), and the Units tab's own search key ?uq= - ?q=
 * belongs to the serial lookup tab.
 */

type Sp = Record<string, string | undefined>;

export const UNIT_GRID: PageOptions<UnitRow> = {
  search: (u) => [u.serialNo, u.productName, u.productCode, u.holderName, u.grnNo, u.supplierName, u.legacyRef],
  sort: {
    serial: (u) => u.serialNo, product: (u) => u.productName, status: (u) => u.status, holder: (u) => u.holderName,
    condition: (u) => u.condition, arrived: (u) => u.receivedAt, grn: (u) => u.grnNo, supplier: (u) => u.supplierName,
  },
};

export function parsePool(sp: Sp): UnitPool | null {
  return sp.pool === 'all' ? null : (UNIT_POOLS as readonly string[]).includes(sp.pool ?? '') ? (sp.pool as UnitPool) : 'in_stock';
}

/** Filters `units` (already loaded by the page, which also needs them whole) or loads them. */
export async function unitsList(ctx: AppContext, sp: Sp, loaded?: UnitRow[]) {
  const units = loaded ?? await listUnits(ctx.scope);
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const pool = parsePool(sp);
  const now = new Date();
  const asPool = (u: UnitRow) => ({ ...u, receivedAt: new Date(u.receivedAt) });
  const picked = units.filter((u) => (!pool || inPool(asPool(u), pool, now)) && inRange(u.receivedAt, filters.range));
  const query = parseGridQuery(sp);
  const found = searchAndSort(picked, { q: (sp.uq ?? '').trim().slice(0, 100), sort: query.sort }, UNIT_GRID);

  // web.show.purchaseRate (F1a): what each unit cost is the clearest purchase
  // rate on any list, so it is blanked here - in the loader the export shares,
  // so a hidden figure cannot be downloaded instead. Costing itself is
  // untouched: `product-cost.ts` still sees real numbers, because job billing
  // and margin depend on them.
  const showCost = (await configFor(ctx)).on('web.show.purchaseRate');
  const rows = showCost ? found : found.map((u) => ({ ...u, unitCostPaise: null }));

  return { rows, pool, filters, showCost };
}
