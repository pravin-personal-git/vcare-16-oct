import 'server-only';
import { db } from './db';
import { userInScope, type StoreScope } from './store-scope';

/**
 * Who sold it - chosen on the quotation, order and invoice forms (4 Oct 2026).
 *
 * Until then all three servers wrote `salespersonId: userId`, so whoever typed
 * the document in got the credit, always. Office staff booking an order for a
 * field salesperson moved that sale onto their own target and incentive, both
 * of which count from this column.
 *
 * The form opens on the signed-in person, so nothing changes for someone
 * entering their own sales. The server checks the choice: an active user who
 * holds a role in the branch the document is being written to. A name typed
 * into the request by hand cannot credit someone from another branch, or
 * someone who has left.
 */

export class SalespersonError extends Error {}

export interface SalespersonOption { id: string; name: string }

/** Active people in this branch, for the dropdown. */
export async function listSalespeople(scope: StoreScope): Promise<SalespersonOption[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, ...userInScope(scope) },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  return rows.map((u) => ({ id: u.id, name: u.fullName }));
}

/**
 * The salesperson to store. No choice (the field switched off, or an older
 * client) falls back to `fallback` - the creator on a new document, the
 * existing salesperson on an edit.
 */
export async function resolveSalesperson(
  storeId: string,
  chosen: string | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  const id = chosen?.trim();
  if (!id) return fallback;
  if (id === fallback) return id;
  const ok = await db.user.findFirst({
    where: { id, isActive: true, storeRoles: { some: { storeId } } },
    select: { id: true },
  });
  if (!ok) throw new SalespersonError('That salesperson is not active in this branch. Choose someone else.');
  return id;
}
