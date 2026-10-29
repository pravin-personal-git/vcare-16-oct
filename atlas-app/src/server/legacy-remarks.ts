import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';

/**
 * The old Vcare software's remarks on one document (29 Oct 2026), oldest
 * first, as the old app listed them. Found by the document's old number, so
 * only migrated documents have any; anything Atlas issued returns null.
 */
export type LegacyRemarkTable = 'InstallationChallan' | 'RepairChallan' | 'Quotation' | 'SalesOrder' | 'Invoice';

const LIMIT = 500;

async function oldNumber(scope: StoreScope, table: LegacyRemarkTable, id: string) {
  const where = { id, ...scopeWhere(scope) };
  const select = { legacyRef: true, storeId: true } as const;
  switch (table) {
    case 'InstallationChallan': return db.installationChallan.findFirst({ where, select });
    case 'RepairChallan': return db.repairChallan.findFirst({ where, select });
    case 'Quotation': return db.quotation.findFirst({ where, select });
    case 'SalesOrder': return db.salesOrder.findFirst({ where, select });
    case 'Invoice': return db.invoice.findFirst({ where, select });
  }
}

export async function legacyRemarksFor(scope: StoreScope, table: LegacyRemarkTable, id: string) {
  const doc = await oldNumber(scope, table, id);
  if (!doc?.legacyRef) return null;
  const [rows, total] = await Promise.all([
    db.legacyRemark.findMany({
      where: { storeId: doc.storeId, docRef: doc.legacyRef },
      select: { id: true, jobRef: true, challanRef: true, kind: true, body: true, authorName: true, at: true },
      orderBy: { at: 'asc' },
      take: LIMIT,
    }),
    db.legacyRemark.count({ where: { storeId: doc.storeId, docRef: doc.legacyRef } }),
  ]);
  return { docRef: doc.legacyRef, rows, total };
}
