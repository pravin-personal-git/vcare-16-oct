import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { CallLogError } from './call-log-error';

/**
 * The published holiday calendar an admin picks FROM, and the per-store
 * toggle that turns one of its entries into a real `Holiday` row.
 *
 * GLOBAL, NOT STORE-SCOPED.
 *
 * `GovernmentHoliday` is the same list for every tenant - a Republic Day is
 * a Republic Day everywhere. `Store.stateId` is a plain string typed by
 * whoever set the branch up (see `administration.ts`), not a foreign key
 * into a formal states table - so state matching here is simple string
 * equality, same as the GST code already does.
 */

export interface GovernmentHolidayRow {
  id: string;
  date: Date;
  name: string;
  state: string | null;
  /** Set when this store already has the matching Holiday row. */
  appliedHolidayId: string | null;
}

export async function listGovernmentHolidays(
  year: number,
  storeStateId: string | null,
  scope: StoreScope,
): Promise<GovernmentHolidayRow[]> {
  const storeId = scopeForWrite(scope);

  const rows = await db.governmentHoliday.findMany({
    where: {
      year,
      OR: [{ state: null }, ...(storeStateId ? [{ state: storeStateId }] : [])],
    },
    orderBy: { date: 'asc' },
    include: {
      holidays: { where: { storeId }, select: { id: true }, take: 1 },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    name: r.name,
    state: r.state,
    appliedHolidayId: r.holidays[0]?.id ?? null,
  }));
}

export async function toggleGovernmentHoliday(
  scope: StoreScope,
  governmentHolidayId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!on) {
    /**
     * Tombstoned, not removed (3 Oct 2026). A holiday that resurrects marks a day
     * as not-worked that people were paid for.
     *
     * `deletedAt: null` is explicit because this is an `updateMany`, which
     * `server/soft-delete` does not filter - without it, switching the same
     * holiday off twice would overwrite when it actually went.
     */
    await db.holiday.updateMany({
      where: { storeId, sourceGovernmentHolidayId: governmentHolidayId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    return;
  }

  const source = await db.governmentHoliday.findUnique({ where: { id: governmentHolidayId } });
  if (!source) throw new CallLogError('That holiday is not on the master list.');

  await db.holiday.create({
    data: {
      storeId,
      date: source.date,
      name: source.name,
      kind: 'public',
      sourceGovernmentHolidayId: source.id,
      createdBy: userId,
    },
  }).catch((e: unknown) => {
    // Same store, same date, same name already exists by hand - toggling
    // on again is a no-op, not an error.
    if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002') return;
    throw e;
  });
}

export interface AddGovernmentHolidayInput {
  date: Date;
  name: string;
  state: string | null;
  year: number;
}

/**
 * Add an entry to the master list.
 *
 * Gated by `attendance.edit` for now, the same as everything else attendance
 * touches - there is no cross-tenant platform-admin role yet (see
 * `post_atmytip_parity_roadmap` memory). Because `GovernmentHoliday` is
 * global, this genuinely edits what every tenant sees, not only the current
 * one - worth a stricter gate once that role exists.
 */
export async function addGovernmentHoliday(input: AddGovernmentHolidayInput): Promise<void> {
  if (!input.name.trim()) throw new CallLogError('Give the holiday a name.');

  await db.governmentHoliday.create({
    data: {
      date: input.date,
      name: input.name.trim(),
      state: input.state?.trim() || null,
      year: input.year,
    },
  }).catch((e: unknown) => {
    if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002') {
      throw new CallLogError('That holiday is already on the master list for that year and state.');
    }
    throw e;
  });
}
