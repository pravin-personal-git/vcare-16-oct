import 'server-only';
import { asCustomValues } from '@/lib/custom-fields';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import type { ProductRow } from '@/lib/product-metrics';
import { assertBarcodeFree } from './product-barcode';

export type { ProductRow } from '@/lib/product-metrics';
export {
  matchesFilter, summarise, DEAD_STOCK_DAYS, NO_SALE_DAYS,
  type ProductFilter,
} from '@/lib/product-metrics';

export async function listProducts(scope: StoreScope): Promise<ProductRow[]> {
  const products = await db.product.findMany({
    where: scopeWhere(scope),
    include: {
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
      brand: { select: { name: true } },
      prices: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      balances: true,
    },
    orderBy: { productCode: 'asc' },
  });

  return products.map((p) => {
    const price = p.prices[0];
    const qty = p.balances.reduce((n, b) => n + b.currentQty, 0);
    const reorder = p.balances.reduce((n, b) => Math.max(n, b.reorderLevel), 0);
    const lastSold = p.balances
      .map((b) => b.lastSoldAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      id: p.id,
      productCode: p.productCode,
      productName: p.productName,
      categoryName: p.category?.name ?? null,
      subCategoryName: p.subCategory?.name ?? null,
      brandName: p.brand?.name ?? null,
      sku: p.sku,
      barcode: p.barcode,
      hsnCode: p.hsnCode,
      location: p.location,
      unit: p.unit,
      mrpPaise: price?.mrpPaise ?? 0,
      dlpPaise: price?.dlpPaise ?? 0,
      currentQty: qty,
      reorderLevel: reorder,
      isCombo: p.isCombo,
      isInOffer: p.isInOffer,
      isActive: p.isActive,
      lastSoldAt: lastSold,
      warrantyMonths: p.warrantyMonths,
      amcAvailable: p.amcAvailable,
      amcPricingMode: p.amcPricingMode,
      amcDurationMonths: p.amcDurationMonths,
      amcAnnualPricePaise: p.amcAnnualPricePaise,
      amcTerms: p.amcTerms,
    };
  });
}

/** Next code for a category: CAM-00001, CAM-00002… */
export async function nextProductCode(storeId: string, categoryId: string | null): Promise<string> {
  const prefix = categoryId
    ? (await db.category.findUnique({ where: { id: categoryId }, select: { codePrefix: true } }))
        ?.codePrefix ?? 'GEN'
    : 'GEN';

  const last = await db.product.findFirst({
    where: { storeId, productCode: { startsWith: `${prefix}-` } },
    orderBy: { productCode: 'desc' },
    select: { productCode: true },
  });

  const n = last ? Number(last.productCode.split('-')[1] ?? 0) + 1 : 1;
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

export interface ProductInput {
  productName: string;
  categoryId: string | null;
  subCategoryId: string | null;
  brandId: string | null;
  hsnCode: string | null;
  sku: string | null;
  barcode: string | null;
  location: string | null;
  unit: string;
  mrpPaise: number;
  dlpPaise: number;
  retailPaise: number;
  wholesalePaise: number;
  costPaise: number;
  taxRatePct: number;
  openingQty: number;
  reorderLevel: number;
  isRateEditable: boolean;

  // ---- warranty and the AMC offer. Added 24 Sep 2026.
  //
  // Two different promises, kept apart. `warrantyMonths` is free cover that
  // comes with the goods. The `amc*` fields are a price-list fact - this
  // product CAN carry a maintenance contract, on these terms. Neither covers
  // anybody until a sale happens: an included AMC becomes a contract when the
  // invoice is issued, an extra-cost one when the customer opts in.
  warrantyMonths: number | null;
  amcAvailable: boolean;
  /** `included` | `extra` | null when AMC is not offered. */
  amcPricingMode: string | null;
  amcDurationMonths: number | null;
  amcAnnualPricePaise: number | null;
  amcTerms: string | null;

  // ---- expiry. Added 2 Oct 2026. See lib/expiry-policy.
  //
  // Deliberately NOT tied to `trackingMode`. Batch tracking answers "which lot
  // did this come from"; expiry answers "will this spoil on my shelf". A kirana
  // store's milk is the second and not the first. Only shown on the form when
  // the platform owner has switched the `expiry` feature on for the tenant.
  tracksExpiry: boolean;
  /** Days it keeps from arrival, when the pack prints no date. */
  shelfLifeDays: number | null;
  /** Days of notice. Null = the platform default (10). */
  expiryWarnDays: number | null;
}

export async function createProduct(scope: StoreScope, input: ProductInput) {
  const storeId = scopeForWrite(scope);   // throws in All Company mode
  // G8 (12 Oct 2026): one barcode, one product, across the business.
  await assertBarcodeFree(scope, input.barcode);
  const productCode = await nextProductCode(storeId, input.categoryId);

  return db.product.create({
    data: {
      storeId,
      productCode,
      productName: input.productName,
      categoryId: input.categoryId,
      subCategoryId: input.subCategoryId,
      brandId: input.brandId,
      hsnCode: input.hsnCode,
      sku: input.sku,
      barcode: input.barcode,
      location: input.location,
      unit: input.unit,
      isRateEditable: input.isRateEditable,
      warrantyMonths: input.warrantyMonths,
      amcAvailable: input.amcAvailable,
      amcPricingMode: input.amcAvailable ? input.amcPricingMode : null,
      amcDurationMonths: input.amcAvailable ? input.amcDurationMonths : null,
      // Cleared when the AMC is included in the price - there is no fee to
      // state, and leaving a stale figure here would show a price on an offer
      // that is free.
      amcAnnualPricePaise: input.amcAvailable && input.amcPricingMode === 'extra'
        ? input.amcAnnualPricePaise
        : null,
      amcTerms: input.amcAvailable ? input.amcTerms : null,
      tracksExpiry: input.tracksExpiry,
      // Cleared when the product does not expire, for the same reason the AMC
      // fields are: a stale shelf life on a product that no longer expires
      // would silently start deriving expiry dates again if somebody ticked
      // the box back on, with numbers nobody reviewed.
      shelfLifeDays: input.tracksExpiry ? input.shelfLifeDays : null,
      expiryWarnDays: input.tracksExpiry ? input.expiryWarnDays : null,
      prices: {
        create: {
          mrpPaise: input.mrpPaise,
          dlpPaise: input.dlpPaise,
          retailPaise: input.retailPaise,
          wholesalePaise: input.wholesalePaise,
          costPaise: input.costPaise,
          taxRatePct: input.taxRatePct,
        },
      },
      balances: {
        create: {
          openingQty: input.openingQty,
          currentQty: input.openingQty,
          reorderLevel: input.reorderLevel,
        },
      },
    },
  });
}

/** Minimal fields for creating a product mid-quotation. */
export interface QuickProductInput {
  productName: string;
  categoryId: string | null;
  dlpPaise: number;
  mrpPaise: number;
  taxRatePct: number;
  hsnCode: string | null;
  unit: string;
}

/**
 * Create a product without leaving the quotation.
 *
 * A salesperson on a call cannot be asked to open another screen, fill a
 * fifteen-field form and come back. This captures the four fields a quotation
 * actually needs; the rest can be completed later from Products.
 */
export async function quickCreateProduct(scope: StoreScope, input: QuickProductInput) {
  const storeId = scopeForWrite(scope);
  const productCode = await nextProductCode(storeId, input.categoryId);

  return db.product.create({
    data: {
      storeId,
      productCode,
      productName: input.productName,
      categoryId: input.categoryId,
      hsnCode: input.hsnCode,
      unit: input.unit,
      isRateEditable: true,
      prices: {
        create: {
          mrpPaise: input.mrpPaise,
          dlpPaise: input.dlpPaise,
          retailPaise: input.mrpPaise,
          wholesalePaise: input.dlpPaise,
          costPaise: 0,
          taxRatePct: input.taxRatePct,
        },
      },
      balances: { create: { openingQty: 0, currentQty: 0, reorderLevel: 0 } },
    },
  });
}

export interface ProductPatch {
  productName?: string;
  hsnCode?: string | null;
  location?: string | null;
  isActive?: boolean;
  isInOffer?: boolean;
  isRateEditable?: boolean;
  dlpPaise?: number;
  mrpPaise?: number;
  reorderLevel?: number;
}

export async function updateProduct(scope: StoreScope, id: string, patch: ProductPatch) {
  const existing = await db.product.findFirst({
    where: { id, ...scopeWhere(scope) }, select: { id: true },
  });
  if (!existing) throw new Error('Product not found in your scope.');

  const { dlpPaise, mrpPaise, reorderLevel, ...productFields } = patch;

  await db.product.update({ where: { id }, data: productFields });

  // Prices are time-effective; a change supersedes rather than overwrites, so
  // a quotation issued last month still reflects the price it was quoted at.
  if (dlpPaise !== undefined || mrpPaise !== undefined) {
    const current = await db.productPrice.findFirst({
      where: { productId: id }, orderBy: { effectiveFrom: 'desc' },
    });
    await db.productPrice.create({
      data: {
        productId: id,
        mrpPaise: mrpPaise ?? current?.mrpPaise ?? 0,
        dlpPaise: dlpPaise ?? current?.dlpPaise ?? 0,
        retailPaise: current?.retailPaise ?? 0,
        wholesalePaise: current?.wholesalePaise ?? 0,
        costPaise: current?.costPaise ?? 0,
        taxRatePct: current?.taxRatePct ?? 18,
      },
    });
  }

  if (reorderLevel !== undefined) {
    const bal = await db.productBalance.findFirst({ where: { productId: id } });
    if (bal) await db.productBalance.update({ where: { id: bal.id }, data: { reorderLevel } });
  }

  return db.product.findUniqueOrThrow({ where: { id } });
}

/**
 * Category, sub-category and brand masters.
 *
 * These existed only as seed data, so a fresh production tenant had three
 * empty dropdowns and no way to fill them - every product would have landed
 * as GEN-00001 with no classification. Creating them inline is the only
 * placement that works: nobody stops mid-product to go and set up a taxonomy.
 */
export async function createCategory(
  scope: StoreScope,
  input: { name: string; parentId: string | null; codePrefix: string | null },
) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required.');

  // Prisma cannot match a composite unique containing NULL, and root
  // categories have parentId = null - so findFirst, not upsert.
  const existing = await db.category.findFirst({
    where: { storeId, name, parentId: input.parentId },
  });
  if (existing) return existing;

  // A sub-category inherits its parent's code prefix so product codes stay
  // consistent regardless of which level was picked.
  let prefix = input.codePrefix?.trim().toUpperCase() || null;
  if (input.parentId && !prefix) {
    const parent = await db.category.findUnique({
      where: { id: input.parentId }, select: { codePrefix: true },
    });
    prefix = parent?.codePrefix ?? null;
  }
  if (!input.parentId && !prefix) {
    prefix = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'GEN';
  }

  return db.category.create({
    data: { storeId, name, parentId: input.parentId, codePrefix: prefix },
  });
}

export async function createBrand(scope: StoreScope, name: string) {
  const storeId = scopeForWrite(scope);
  const clean = name.trim();
  if (!clean) throw new Error('Brand name is required.');

  return db.brand.upsert({
    where: { storeId_name: { storeId, name: clean } },
    update: {},
    create: { storeId, name: clean },
  });
}

/** Full record for the edit form, with the current price row flattened in. */
export async function getProduct(scope: StoreScope, id: string) {
  const p = await db.product.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      prices: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      balances: { take: 1 },
    },
  });
  if (!p) return null;

  const price = p.prices[0];
  const bal = p.balances[0];

  return {
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    categoryId: p.categoryId,
    subCategoryId: p.subCategoryId,
    brandId: p.brandId,
    hsnCode: p.hsnCode,
    sku: p.sku,
    barcode: p.barcode,
    location: p.location,
    unit: p.unit,
    isActive: p.isActive,
    isInOffer: p.isInOffer,
    isRateEditable: p.isRateEditable,
    mrp: (price?.mrpPaise ?? 0) / 100,
    dlp: (price?.dlpPaise ?? 0) / 100,
    retail: (price?.retailPaise ?? 0) / 100,
    wholesale: (price?.wholesalePaise ?? 0) / 100,
    cost: (price?.costPaise ?? 0) / 100,
    taxRatePct: Number(price?.taxRatePct ?? 18),
    currentQty: bal?.currentQty ?? 0,
    reorderLevel: bal?.reorderLevel ?? 0,
    // Warranty and the AMC offer. Passed through as stored, including the
    // nulls: the form has to be able to show an empty warranty box rather than
    // a zero, because those mean different things to the coverage rule.
    warrantyMonths: p.warrantyMonths,
    amcAvailable: p.amcAvailable,
    amcPricingMode: p.amcPricingMode,
    amcDurationMonths: p.amcDurationMonths,
    amcAnnualPricePaise: p.amcAnnualPricePaise,
    amcTerms: p.amcTerms,
    tracksExpiry: p.tracksExpiry,
    shelfLifeDays: p.shelfLifeDays,
    expiryWarnDays: p.expiryWarnDays,
    customFields: asCustomValues(p.customFields),
  };
}

export interface ProductFullPatch {
  productName: string;
  categoryId: string | null;
  subCategoryId: string | null;
  brandId: string | null;
  hsnCode: string | null;
  sku: string | null;
  barcode: string | null;
  location: string | null;
  unit: string;
  isActive: boolean;
  isInOffer: boolean;
  isRateEditable: boolean;
  mrpPaise: number;
  dlpPaise: number;
  retailPaise: number;
  wholesalePaise: number;
  costPaise: number;
  taxRatePct: number;
  reorderLevel: number;
  /** Warranty and the AMC offer - see the note on `ProductInput`. */
  warrantyMonths: number | null;
  amcAvailable: boolean;
  amcPricingMode: string | null;
  amcDurationMonths: number | null;
  amcAnnualPricePaise: number | null;
  amcTerms: string | null;

  // ---- expiry. Added 2 Oct 2026. See lib/expiry-policy.
  //
  // Deliberately NOT tied to `trackingMode`. Batch tracking answers "which lot
  // did this come from"; expiry answers "will this spoil on my shelf". A kirana
  // store's milk is the second and not the first. Only shown on the form when
  // the platform owner has switched the `expiry` feature on for the tenant.
  tracksExpiry: boolean;
  /** Days it keeps from arrival, when the pack prints no date. */
  shelfLifeDays: number | null;
  /** Days of notice. Null = the platform default (10). */
  expiryWarnDays: number | null;
}

/**
 * Full product edit.
 *
 * The product code is NOT editable. It appears on quotations already sent, and
 * changing it would break the link between a document and the item it lists.
 *
 * A price change writes a NEW price row rather than updating the old one, and
 * only when something actually changed - so a quotation issued last month still
 * reports the price it was quoted at, and unchanged saves do not litter the
 * price history.
 */
export async function updateProductFull(
  scope: StoreScope, id: string, patch: ProductFullPatch,
) {
  const existing = await db.product.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { prices: { orderBy: { effectiveFrom: 'desc' }, take: 1 }, balances: { take: 1 } },
  });
  if (!existing) throw new Error('Product not found in your scope.');
  if (!patch.productName.trim()) throw new Error('Product name is required.');
  // G8: only checked when the barcode changes, so a product that already shares
  // one (from before the rule) can still be edited until it is cleaned up.
  if ((patch.barcode ?? '').trim().toUpperCase() !== (existing.barcode ?? '').trim().toUpperCase()) {
    await assertBarcodeFree(scope, patch.barcode, id);
  }

  await db.product.update({
    where: { id },
    data: {
      productName: patch.productName.trim(),
      categoryId: patch.categoryId,
      subCategoryId: patch.subCategoryId,
      brandId: patch.brandId,
      hsnCode: patch.hsnCode,
      sku: patch.sku,
      barcode: patch.barcode,
      location: patch.location,
      unit: patch.unit,
      isActive: patch.isActive,
      isInOffer: patch.isInOffer,
      isRateEditable: patch.isRateEditable,
      warrantyMonths: patch.warrantyMonths,
      amcAvailable: patch.amcAvailable,
      // Dependent fields are cleared rather than left behind when the offer is
      // switched off or switched to `included`. A stale yearly price on a
      // product whose AMC is now free would be shown on the invoice line as a
      // charge nobody agreed to.
      amcPricingMode: patch.amcAvailable ? patch.amcPricingMode : null,
      amcDurationMonths: patch.amcAvailable ? patch.amcDurationMonths : null,
      amcAnnualPricePaise: patch.amcAvailable && patch.amcPricingMode === 'extra'
        ? patch.amcAnnualPricePaise
        : null,
      amcTerms: patch.amcAvailable ? patch.amcTerms : null,
      tracksExpiry: patch.tracksExpiry,
      shelfLifeDays: patch.tracksExpiry ? patch.shelfLifeDays : null,
      expiryWarnDays: patch.tracksExpiry ? patch.expiryWarnDays : null,
    },
  });

  const cur = existing.prices[0];
  const priceChanged = !cur
    || cur.mrpPaise !== patch.mrpPaise
    || cur.dlpPaise !== patch.dlpPaise
    || cur.retailPaise !== patch.retailPaise
    || cur.wholesalePaise !== patch.wholesalePaise
    || cur.costPaise !== patch.costPaise
    || Number(cur.taxRatePct) !== patch.taxRatePct;

  if (priceChanged) {
    await db.productPrice.create({
      data: {
        productId: id,
        mrpPaise: patch.mrpPaise,
        dlpPaise: patch.dlpPaise,
        retailPaise: patch.retailPaise,
        wholesalePaise: patch.wholesalePaise,
        costPaise: patch.costPaise,
        taxRatePct: patch.taxRatePct,
      },
    });
  }

  const bal = existing.balances[0];
  if (bal && bal.reorderLevel !== patch.reorderLevel) {
    await db.productBalance.update({
      where: { id: bal.id }, data: { reorderLevel: patch.reorderLevel },
    });
  }

  return db.product.findUniqueOrThrow({ where: { id } });
}
