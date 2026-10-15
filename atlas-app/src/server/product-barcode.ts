import 'server-only';
import { db } from './db';
import type { StoreScope } from './store-scope';

/**
 * ONE BARCODE, ONE PRODUCT (Scan-to-Stock G8, 12 Oct 2026). Decision: refused
 * within the whole business, not only the branch. Every path that writes a
 * product's barcode calls `assertBarcodeFree`: the product form (add and
 * edit), the bulk import, and create-from-scan.
 */

export class ScanProductError extends Error {}

/** Every store of the organisation that owns this scope's store(s). */
async function businessStoreIds(scope: StoreScope): Promise<string[]> {
  const ids = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const orgs = await db.store.findMany({ where: { id: { in: ids } }, select: { organizationId: true } });
  const orgIds = [...new Set(orgs.map((o) => o.organizationId))];
  const stores = await db.store.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  return stores.map((s) => s.id);
}

/** The product (anywhere in the business) that already has this barcode, other than `exceptId`. */
export async function barcodeTakenBy(
  scope: StoreScope, barcode: string | null | undefined, exceptId?: string | null,
): Promise<{ id: string; productCode: string; productName: string } | null> {
  const code = barcode?.trim();
  if (!code) return null;
  const storeIds = await businessStoreIds(scope);
  return db.product.findFirst({
    where: {
      storeId: { in: storeIds },
      barcode: { equals: code, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, productCode: true, productName: true },
  });
}

/** The refusal, in words - shared by every save path. */
export async function assertBarcodeFree(scope: StoreScope, barcode: string | null | undefined, exceptId?: string | null) {
  const other = await barcodeTakenBy(scope, barcode, exceptId);
  if (other) {
    throw new ScanProductError(
      `Barcode ${barcode!.trim()} is already on ${other.productCode} ${other.productName}. `
      + 'One barcode names one product, so every scan means one thing. Use that product, or correct the barcode.',
    );
  }
}

/** Barcodes saved on more than one product in the business - the one-time clean-up list (G8). */
export async function duplicateBarcodes(scope: StoreScope) {
  const storeIds = await businessStoreIds(scope);
  const rows = await db.product.findMany({
    where: { storeId: { in: storeIds }, barcode: { not: null } },
    select: { id: true, productCode: true, productName: true, barcode: true, storeId: true, isActive: true },
    orderBy: { productCode: 'asc' },
  });
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.barcode!.trim().toUpperCase();
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].filter(([, list]) => list.length > 1).map(([barcode, products]) => ({ barcode, products }));
}

