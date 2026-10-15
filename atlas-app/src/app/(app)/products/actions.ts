'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { createProduct, type ProductInput } from '@/server/products';
import { readSubmittedValues, writeValues } from '@/server/custom-fields';
import { db } from '@/server/db';

export interface ProductFormState {
  error?: string;
  ok?: boolean;
  /** Set when a price change was held for approval; everything else saved. */
  message?: string;
}

/**
 * Product price - change, through Approval Rules (5 Oct 2026). Returns the
 * prices to save NOW (the current ones when the change is held) and the
 * message to show. A price feeds every quotation after it, so a changed DLP or
 * MRP can wait for a sign-off while the rest of the product saves.
 */
async function gatePrice(
  scope: Awaited<ReturnType<typeof requireContext>>['scope'], userId: string, id: string,
  next: { dlpPaise?: number; mrpPaise?: number },
): Promise<{ dlpPaise?: number; mrpPaise?: number; message: string | null }> {
  if (scope.kind !== 'single' || (next.dlpPaise === undefined && next.mrpPaise === undefined)) return { ...next, message: null };
  const { getProduct } = await import('@/server/products');
  const cur = await getProduct(scope, id);
  if (!cur) return { ...next, message: null };
  const curDlp = Math.round(cur.dlp * 100);
  const curMrp = Math.round(cur.mrp * 100);
  const changed = (next.dlpPaise !== undefined && next.dlpPaise !== curDlp) || (next.mrpPaise !== undefined && next.mrpPaise !== curMrp);
  if (!changed) return { ...next, message: null };
  const message = await heldMessage(scope, userId, {
    type: 'price_change', entityId: id, amountPaise: null,
    title: `Price of ${cur.productName}: DLP ${rupeesText(curDlp)} -> ${rupeesText(next.dlpPaise ?? curDlp)}, MRP ${rupeesText(curMrp)} -> ${rupeesText(next.mrpPaise ?? curMrp)}`,
    summary: cur.productCode, payload: { ...next },
  });
  return message ? { dlpPaise: curDlp, mrpPaise: curMrp, message } : { ...next, message: null };
}

const priceHeldText = (m: string | null) =>
  (m ? `Saved, but the new price was ${m.charAt(0).toLowerCase()}${m.slice(1)}` : undefined);

const rupeesToPaise = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const intOf = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? '0'));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * A blank number field means "not set", NOT zero.
 *
 * `intOf` returns 0 for an empty string, which is right for an opening
 * quantity and wrong for a warranty: 0 months reads as "this product carries no
 * warranty", which is a claim, whereas null is "nobody has said". The coverage
 * rule treats those differently - see `warrantyUntil` in lib/amc-coverage - so
 * the distinction has to survive the form.
 */
const nullableIntOf = (v: FormDataEntryValue | null): number | null => {
  const raw = String(v ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const nullablePaiseOf = (v: FormDataEntryValue | null): number | null => {
  const raw = String(v ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Expiry, shared by the add and edit forms.
 *
 * `enabled` is the PLATFORM owner's switch, read from the context rather than
 * from the form - a client cannot grant themselves the feature by posting the
 * field. When it is off the three values are forced to their defaults, so a
 * form crafted by hand cannot turn expiry tracking on either.
 */
function expiryFieldsFrom(formData: FormData, enabled: boolean) {
  const tracksExpiry = enabled && formData.get('tracksExpiry') === 'on';
  return {
    tracksExpiry,
    shelfLifeDays: tracksExpiry ? nullableIntOf(formData.get('shelfLifeDays')) : null,
    expiryWarnDays: tracksExpiry ? nullableIntOf(formData.get('expiryWarnDays')) : null,
  };
}

/** Warranty and the AMC offer, shared by the add and edit forms. */
function amcFieldsFrom(formData: FormData) {
  const amcAvailable = formData.get('amcAvailable') === 'on';
  const mode = String(formData.get('amcPricingMode') ?? '').trim() || null;
  return {
    warrantyMonths: nullableIntOf(formData.get('warrantyMonths')),
    amcAvailable,
    // The server clears the dependent fields too when the offer is off; doing
    // it here as well means the values never reach the database in the first
    // place, so a future caller that skips that guard cannot reintroduce them.
    amcPricingMode: amcAvailable ? mode : null,
    amcDurationMonths: amcAvailable ? nullableIntOf(formData.get('amcDurationMonths')) : null,
    amcAnnualPricePaise: amcAvailable && mode === 'extra'
      ? nullablePaiseOf(formData.get('amcAnnualPrice'))
      : null,
    amcTerms: amcAvailable
      ? (String(formData.get('amcTerms') ?? '').trim() || null)
      : null,
  };
}

export async function addProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to add products.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before adding a product.' };
    }

    const productName = String(formData.get('productName') ?? '').trim();
    if (!productName) return { error: 'Product name is required.' };

    const input: ProductInput = {
      productName,
      categoryId: (formData.get('categoryId') as string) || null,
      subCategoryId: (formData.get('subCategoryId') as string) || null,
      brandId: (formData.get('brandId') as string) || null,
      hsnCode: (String(formData.get('hsnCode') ?? '').trim()) || null,
      sku: (String(formData.get('sku') ?? '').trim()) || null,
      barcode: (String(formData.get('barcode') ?? '').trim()) || null,
      location: (String(formData.get('location') ?? '').trim()) || null,
      unit: String(formData.get('unit') ?? 'pcs'),
      mrpPaise: rupeesToPaise(formData.get('mrp')),
      dlpPaise: rupeesToPaise(formData.get('dlp')),
      retailPaise: rupeesToPaise(formData.get('retail')),
      wholesalePaise: rupeesToPaise(formData.get('wholesale')),
      costPaise: rupeesToPaise(formData.get('cost')),
      taxRatePct: Number(formData.get('taxRate') ?? 18),
      openingQty: intOf(formData.get('openingQty')),
      reorderLevel: intOf(formData.get('reorderLevel')),
      isRateEditable: formData.get('isRateEditable') === 'on',
      ...amcFieldsFrom(formData),
      ...expiryFieldsFrom(formData, ctx.features.has('expiry')),
    };

    // Settings > Custom Fields - checked before anything is written.
    const custom = await readSubmittedValues(ctx.scope, 'product', formData, input.categoryId);
    if (custom.error) return { error: custom.error };

    const created = await createProduct(ctx.scope, input);
    await writeValues('product', created.id, custom.values);

    await db.activityLog.create({
      data: {
        storeId: created.storeId,
        userId: ctx.user.id,
        activityType: 'Create',
        entityType: 'Product',
        entityId: created.id,
        description: `Product '${created.productName}' created (${created.productCode})`,
      },
    }).catch((e) => console.error('[products] audit write failed (non-fatal)', e));

    revalidatePath('/products');
    return { ok: true };
  } catch (err) {
    // G8: the duplicate-barcode refusal is written for the person on screen.
    const { ScanProductError } = await import('@/server/product-barcode');
    if (err instanceof ScanProductError) return { error: err.message };
    console.error('[products] create failed', err);
    return { error: 'Could not save the product. Please try again.' };
  }
}

export async function editProduct(
  id: string,
  patch: {
    productName?: string; hsnCode?: string | null; location?: string | null;
    isActive?: boolean; isInOffer?: boolean; isRateEditable?: boolean;
    dlp?: number; mrp?: number; reorderLevel?: number;
  },
): Promise<ProductFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to edit products.' };
    }

    const priced = await gatePrice(ctx.scope, ctx.user.id, id, {
      dlpPaise: patch.dlp !== undefined ? Math.round(patch.dlp * 100) : undefined,
      mrpPaise: patch.mrp !== undefined ? Math.round(patch.mrp * 100) : undefined,
    });
    const { updateProduct } = await import('@/server/products');
    const p = await updateProduct(ctx.scope, id, {
      ...patch,
      dlpPaise: patch.dlp !== undefined ? priced.dlpPaise : undefined,
      mrpPaise: patch.mrp !== undefined ? priced.mrpPaise : undefined,
    });

    await db.activityLog.create({
      data: {
        storeId: p.storeId, userId: ctx.user.id,
        activityType: 'Update', entityType: 'Product', entityId: p.id,
        description: `Product '${p.productName}' updated (${p.productCode})`,
      },
    }).catch(() => undefined);

    revalidatePath('/products');
    return { ok: true, message: priceHeldText(priced.message) };
  } catch (err) {
    console.error('[products] edit failed', err);
    return { error: 'Could not save the change.' };
  }
}

export interface MasterResult {
  error?: string;
  item?: { id: string; name: string; parentId: string | null; codePrefix: string | null };
}

export async function addCategory(
  name: string, parentId: string | null, codePrefix: string | null,
): Promise<MasterResult> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to add categories.' };
    }
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };

    const { createCategory } = await import('@/server/products');
    const c = await createCategory(ctx.scope, { name, parentId, codePrefix });

    revalidatePath('/products');
    revalidatePath('/quotation');
    return { item: { id: c.id, name: c.name, parentId: c.parentId, codePrefix: c.codePrefix } };
  } catch (err) {
    console.error('[products] add category failed', err);
    return { error: 'Could not create the category.' };
  }
}

export async function addBrand(name: string): Promise<MasterResult> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to add brands.' };
    }
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };

    const { createBrand } = await import('@/server/products');
    const b = await createBrand(ctx.scope, name);

    revalidatePath('/products');
    return { item: { id: b.id, name: b.name, parentId: null, codePrefix: null } };
  } catch (err) {
    console.error('[products] add brand failed', err);
    return { error: 'Could not create the brand.' };
  }
}

export async function loadProduct(id: string) {
  const ctx = await requireContext();
  const { getProduct } = await import('@/server/products');
  return getProduct(ctx.scope, id);
}

export async function saveProduct(
  id: string, _prev: ProductFormState, formData: FormData,
): Promise<ProductFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to edit products.' };
    }

    const name = String(formData.get('productName') ?? '').trim();
    if (!name) return { error: 'Product name is required.' };
    const custom = await readSubmittedValues(ctx.scope, 'product', formData, (formData.get('categoryId') as string) || null);
    if (custom.error) return { error: custom.error };

    const priced = await gatePrice(ctx.scope, ctx.user.id, id, {
      dlpPaise: rupeesToPaise(formData.get('dlp')), mrpPaise: rupeesToPaise(formData.get('mrp')),
    });
    const { updateProductFull } = await import('@/server/products');
    const p = await updateProductFull(ctx.scope, id, {
      productName: name,
      categoryId: (formData.get('categoryId') as string) || null,
      subCategoryId: (formData.get('subCategoryId') as string) || null,
      brandId: (formData.get('brandId') as string) || null,
      hsnCode: (String(formData.get('hsnCode') ?? '').trim()) || null,
      sku: (String(formData.get('sku') ?? '').trim()) || null,
      barcode: (String(formData.get('barcode') ?? '').trim()) || null,
      location: (String(formData.get('location') ?? '').trim()) || null,
      unit: String(formData.get('unit') ?? 'pcs'),
      isActive: formData.get('isActive') === 'on',
      isInOffer: formData.get('isInOffer') === 'on',
      isRateEditable: formData.get('isRateEditable') === 'on',
      mrpPaise: priced.mrpPaise ?? rupeesToPaise(formData.get('mrp')),
      dlpPaise: priced.dlpPaise ?? rupeesToPaise(formData.get('dlp')),
      retailPaise: rupeesToPaise(formData.get('retail')),
      wholesalePaise: rupeesToPaise(formData.get('wholesale')),
      costPaise: rupeesToPaise(formData.get('cost')),
      taxRatePct: Number(formData.get('taxRate') ?? 18),
      reorderLevel: intOf(formData.get('reorderLevel')),
      ...amcFieldsFrom(formData),
      ...expiryFieldsFrom(formData, ctx.features.has('expiry')),
    });
    await writeValues('product', p.id, custom.values);

    await db.activityLog.create({
      data: {
        storeId: p.storeId, userId: ctx.user.id,
        activityType: 'Update', entityType: 'Product', entityId: p.id,
        description: `Product '${p.productName}' updated (${p.productCode})`,
      },
    }).catch(() => undefined);

    revalidatePath('/products');
    return { ok: true, message: priceHeldText(priced.message) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the product.';
    console.error('[products] save failed', err);
    return { error: msg };
  }
}

/**
 * Stock adjustment - the way a wrong number gets corrected.
 *
 * You do not type a difference, you type what you counted. The system works
 * out the delta itself. Asking for the difference means doing arithmetic in
 * your head while standing at a shelf, and a sign error there writes the
 * mistake in twice as large.
 */
export async function adjustStock(input: {
  productId: string;
  countedQty: number;
  note: string;
}): Promise<{ error?: string; ok?: boolean; message?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'Adjusting stock needs the products edit permission.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before adjusting stock.' };
    }
    if (!Number.isInteger(input.countedQty)) {
      return { error: 'Enter a whole number - you cannot count half a piece.' };
    }
    if (input.countedQty < 0) {
      return { error: 'A counted quantity cannot be negative. Enter what is actually on the shelf.' };
    }
    if (!input.note.trim()) {
      return {
        error: 'Say why. An adjustment with no reason is indistinguishable from someone covering a mistake.',
      };
    }

    const { recordAdjustment } = await import('@/server/stock');
    const res = await recordAdjustment(
      ctx.scope,
      ctx.scope.storeId,
      ctx.user.id,
      input.productId,
      input.countedQty,
      input.note.trim(),
    );

    if (res.delta === 0) {
      return { ok: true, message: 'The count matched. Nothing to change.' };
    }

    revalidatePath('/products');
    revalidatePath('/reports/stock-health');

    /**
     * What happened to the UNITS is reported too, because for a serial product
     * the count now corrects both ledgers and the person needs to know they
     * have labels to print. Said only when there is something to say - a
     * quantity-tracked product's message is unchanged.
     */
    const identity = [
      res.unitsTagged > 0
        ? `${res.unitsTagged} item${res.unitsTagged === 1 ? '' : 's'} had no serial, so Atlas numbered them - print the labels from Serial & Batch Stock.`
        : null,
      res.unitsLost > 0
        ? `${res.unitsLost} numbered item${res.unitsLost === 1 ? ' was' : 's were'} marked lost.`
        : null,
    ].filter(Boolean).join(' ');

    const base = res.delta > 0
      ? `Stock raised by ${res.delta}. Now ${res.balanceAfter}.`
      : `Stock reduced by ${Math.abs(res.delta)}. Now ${res.balanceAfter}.`;

    return { ok: true, message: identity ? `${base} ${identity}` : base };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not adjust the stock.' };
  }
}
