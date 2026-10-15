import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { findUnitsBySerial } from './stock-units';

/**
 * "What is this?" for a scanned code - the store keeper's first question.
 * A code can be a product's own code or barcode, or the serial of a unit we
 * already hold; both are answered in one call.
 */
export async function lookupCode(scope: StoreScope, code: string) {
  const q = code.trim().slice(0, 120);
  if (q.length < 2) return { products: [], units: [] };
  const [products, units] = await Promise.all([
    db.product.findMany({
      where: {
        ...scopeWhere(scope),
        OR: [{ productCode: { equals: q, mode: 'insensitive' } }, { barcode: { equals: q, mode: 'insensitive' } }],
      },
      select: { id: true, productCode: true, productName: true, barcode: true, trackingMode: true },
      take: 10,
    }),
    findUnitsBySerial(scope, q),
  ]);
  return { products, units };
}

/** Products by name or code as the store keeper types. */
export async function searchProducts(scope: StoreScope, q: string) {
  const s = q.trim().slice(0, 80);
  if (s.length < 2) return [];
  return db.product.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [
        { productName: { contains: s, mode: 'insensitive' } },
        { productCode: { contains: s, mode: 'insensitive' } },
        { barcode: { equals: s, mode: 'insensitive' } },
      ],
    },
    select: { id: true, productCode: true, productName: true, barcode: true, trackingMode: true },
    orderBy: { productName: 'asc' },
    take: 25,
  });
}

/** Suppliers by name, company or phone. */
export async function searchSuppliers(scope: StoreScope, q: string) {
  const s = q.trim().slice(0, 80);
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(scope),
      isSupplier: true,
      ...(s ? {
        OR: [
          { companyName: { contains: s, mode: 'insensitive' } },
          { firstName: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s } },
          { gstin: { equals: s.toUpperCase() } },
        ],
      } : {}),
    },
    select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, gstin: true },
    orderBy: { companyName: 'asc' },
    take: 25,
  });
  return rows.map((p) => ({
    id: p.id, name: p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' '), phone: p.phone, gstin: p.gstin,
  }));
}
