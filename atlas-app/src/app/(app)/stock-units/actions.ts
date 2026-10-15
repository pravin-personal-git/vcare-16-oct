'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  findUnitsBySerial, getUnitDetail, moveUnit, setUnitCondition, setUnitSerial,
  fillPlaceholders, saveUnitFields, planOpeningImport, importOpeningStock,
  saveStockField, setStockFieldActive, setWarrantyBasis, StockUnitError,
} from '@/server/stock-units';
import { friendlyError } from '@/lib/friendly-error';

export interface UnitActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * READ wide, WRITE narrow - the rule the rest of this tenant's modules follow.
 *
 * Reading a unit - "whose is this camera, is it in warranty" - is what a
 * technician on site needs, so it is open to anyone who can see complaints
 * (all 22 staff in the migrated tenant) as well as to whoever handles stock.
 * Changing a unit moves stock, so it needs `purchase.edit`, the permission
 * that already governs receiving goods. Reusing both rather than inventing
 * `units.view`/`units.edit`: a new key needs rows for every role, and a missing
 * row resolves to false.
 */
export async function canReadUnits(permissions: Set<string>): Promise<boolean> {
  return permissions.has('complaints.view') || permissions.has('purchase.edit') || permissions.has('products.edit');
}

async function guardWrite(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string | void>): Promise<UnitActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('purchase.edit')) return { error: 'Only somebody who can receive stock can change a unit.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    const message = await run(ctx);
    revalidatePath('/stock-units');
    revalidatePath('/products');
    return { ok: true, message: message || undefined };
  } catch (err) {
    if (err instanceof StockUnitError) return { error: err.message };
    console.error('[stock-units] action failed', err);
    return { error: friendlyError(err, true) };
  }
}

async function guardRead() {
  const ctx = await requireContext();
  if (!(await canReadUnits(ctx.permissions))) throw new StockUnitError('You do not have access to stock units.');
  return ctx;
}

/** Serialise dates for the client - Date does not survive a server action as a Date. */
const iso = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function lookupUnitsAction(query: string) {
  try {
    const ctx = await guardRead();
    return { rows: iso(await findUnitsBySerial(ctx.scope, query)) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Lookup failed.', rows: [] };
  }
}

export async function loadUnitDetailAction(id: string) {
  try {
    const ctx = await guardRead();
    return { detail: iso(await getUnitDetail(ctx.scope, id)) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load that unit.' };
  }
}

export async function moveUnitAction(id: string, input: {
  to: string; partyId: string | null; invoiceNo: string | null; condition: string | null; note: string | null;
}): Promise<UnitActionState> {
  return guardWrite(async (ctx) => {
    let invoiceId: string | null = null;
    const no = input.invoiceNo?.trim();
    if (no) {
      // By number, because that is what is written on the paperwork in hand.
      const inv = await db.invoice.findFirst({
        where: { storeId: ctx.scope.kind === 'single' ? ctx.scope.storeId : '', invoiceNo: { equals: no, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!inv) throw new StockUnitError(`No invoice ${no} in this store.`);
      invoiceId = inv.id;
    }
    await moveUnit(ctx.scope, id, {
      to: input.to, partyId: input.partyId, invoiceId, condition: input.condition, note: input.note,
    }, ctx.user.id);
    return invoiceId ? 'Moved, and linked to the invoice. Its stock had already left with that invoice.' : 'Moved.';
  });
}

export async function setConditionAction(id: string, condition: string, note: string | null) {
  return guardWrite(async (ctx) => { await setUnitCondition(ctx.scope, id, condition, note, ctx.user.id); });
}

export async function setSerialAction(id: string, serial: string) {
  return guardWrite(async (ctx) => { await setUnitSerial(ctx.scope, id, serial, ctx.user.id); });
}

export async function fillPlaceholdersAction(productId: string, text: string) {
  return guardWrite(async (ctx) => {
    const r = await fillPlaceholders(ctx.scope, productId, text, ctx.user.id);
    return `${r.filled} serial${r.filled === 1 ? '' : 's'} recorded.${r.remaining > 0 ? ` ${r.remaining} still to follow.` : ''}`;
  });
}

export async function saveUnitFieldsAction(id: string, values: Record<string, unknown>) {
  return guardWrite(async (ctx) => { await saveUnitFields(ctx.scope, id, values, ctx.user.id); });
}

export async function planOpeningAction(csvText: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('purchase.edit')) return { error: 'You cannot import stock.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    return { plan: iso(await planOpeningImport(ctx.scope, csvText)) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read that file.' };
  }
}

export async function importOpeningAction(csvText: string) {
  return guardWrite(async (ctx) => {
    const r = await importOpeningStock(ctx.scope, csvText, ctx.user.id);
    return `Opening stock in: ${r.qty} across ${r.lines} line${r.lines === 1 ? '' : 's'}, ${r.units} unit record${r.units === 1 ? '' : 's'}.`;
  });
}

/**
 * The store's own unit fields and settings. On `settings.edit` rather than
 * `purchase.edit`: defining what every unit record carries is configuring the
 * store, the same class of change as the complaint fields.
 */
async function guardSettings(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<void>): Promise<UnitActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Only somebody who can change settings can do this.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    await run(ctx);
    revalidatePath('/stock-units');
    return { ok: true };
  } catch (err) {
    if (err instanceof StockUnitError) return { error: err.message };
    console.error('[stock-units] settings failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveStockFieldAction(input: {
  fieldKey: string | null; label: string; fieldType: string; options: string | null;
  required: boolean; categoryId: string | null; sortOrder: number;
}) {
  return guardSettings(async (ctx) => { await saveStockField(ctx.scope, input); });
}

export async function setStockFieldActiveAction(fieldKey: string, isActive: boolean) {
  return guardSettings(async (ctx) => { await setStockFieldActive(ctx.scope, fieldKey, isActive); });
}

export async function setWarrantyBasisAction(basis: string) {
  return guardSettings(async (ctx) => { await setWarrantyBasis(ctx.scope, basis); });
}
