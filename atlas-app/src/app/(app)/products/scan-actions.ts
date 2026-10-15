'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  ScanProductError, barcodeTakenBy, createProductFromScan, scanProductOptions, type ScanProductInput,
} from '@/server/product-from-scan';
import { lookupCode } from '@/server/stock-lookup';
import { cleanScannedCode } from '@/lib/scan/codes';

/**
 * Scan-to-Stock actions (12 Oct 2026): create a product from a scan (G2/G5),
 * check a barcode is free (G8), and "what is this code?" for the website
 * receipt and stock-in (G4/G6). Creating needs `products.edit` - decision
 * 12 Oct: anyone the role lets create products.
 */

export interface CreatedProduct { id: string; code: string; name: string; trackingMode: string; barcode: string | null }

export async function quickProductOptionsAction() {
  const ctx = await requireContext();
  const canCreate = ctx.scope.kind === 'single' && ctx.permissions.has('products.edit');
  if (!canCreate) return { canCreate, categories: [] };
  return { canCreate, ...(await scanProductOptions(ctx.scope)) };
}

export async function createProductFromScanAction(input: ScanProductInput): Promise<{ error?: string; product?: CreatedProduct }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) return { error: 'You do not have permission to add products. Ask someone who can.' };
    if (ctx.scope.kind !== 'single') return { error: 'Select a single store before adding a product.' };
    const p = await createProductFromScan(ctx.scope, input);
    await db.activityLog.create({
      data: {
        storeId: p.storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'Product', entityId: p.id,
        description: `Product '${p.productName}' created from a scan (${p.productCode}${p.barcode ? `, barcode ${p.barcode}` : ''})`,
      },
    }).catch((e) => console.error('[scan-product] audit write failed (non-fatal)', e));
    revalidatePath('/products');
    return { product: { id: p.id, code: p.productCode, name: p.productName, trackingMode: p.trackingMode, barcode: p.barcode } };
  } catch (e) {
    if (e instanceof ScanProductError) return { error: e.message };
    console.error('[scan-product] create failed', e);
    return { error: 'Could not create the product. Please try again.' };
  }
}

/** G8: who already has this barcode (for the product form's live check). */
export async function barcodeOwnerAction(barcode: string, exceptId: string | null): Promise<{ owner: { code: string; name: string } | null }> {
  const ctx = await requireContext();
  const o = await barcodeTakenBy(ctx.scope, barcode, exceptId);
  return { owner: o ? { code: o.productCode, name: o.productName } : null };
}

/** What a scanned code is on file as: products by barcode / code, units by serial or house tag. */
export async function lookupScanAction(raw: string) {
  const ctx = await requireContext();
  const code = cleanScannedCode(raw);
  const r = await lookupCode(ctx.scope, code);
  return {
    code,
    products: r.products.map((p) => ({ id: p.id, code: p.productCode, name: p.productName, barcode: p.barcode, trackingMode: p.trackingMode })),
    // Exact serials only - a scan is a whole code, never a fragment.
    units: r.units.filter((u) => (u.serialNo ?? '').toUpperCase() === code.toUpperCase()).map((u) => ({
      id: u.id, serialNo: u.serialNo, status: u.status, productId: u.productId,
      productCode: u.productCode, productName: u.productName,
    })),
  };
}
