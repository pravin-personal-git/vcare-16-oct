'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  CustomFieldError, deleteField, fieldSetup, isFieldEntity, moveField, readSubmittedValues,
  saveField, setFieldActive, setStandardField, valuesOf, writeValues, type FieldInput,
} from '@/server/custom-fields';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import type { FieldEntity } from '@/lib/custom-fields';

/**
 * Custom fields (26 Sep 2026). Forms read the setup through here; the
 * settings screen changes it (owner / settings.edit only); a detail page can
 * save just the extra fields of one record.
 */
export interface FieldActionResult { ok?: boolean; error?: string }

/**
 * Who may save the extra values on one record. Only the three entities that
 * have custom values at all appear here; the document entities carry field
 * RULES, which are a settings change and go through `settingsGuard`.
 */
const EDIT_PERMISSION: Partial<Record<FieldEntity, string>> = {
  customer: 'customers.edit', lead: 'leads.edit', product: 'products.edit',
};

async function settingsGuard(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<unknown>): Promise<FieldActionResult> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Only an owner or admin can change custom fields.' };
    if (ctx.scope.kind === 'all') return { error: 'Pick a branch first - each branch keeps its own fields.' };
    await run(ctx);
    revalidatePath('/settings/custom-fields');
    return { ok: true };
  } catch (e) {
    if (e instanceof CustomFieldError) return { error: e.message };
    console.error('[custom-fields] settings action failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}

export async function fieldSetupAction(entity: FieldEntity) {
  const ctx = await requireContext();
  if (!isFieldEntity(entity)) return { custom: [], standard: {} };
  return fieldSetup(ctx.scope, entity);
}

export async function customValuesAction(entity: FieldEntity, id: string) {
  const ctx = await requireContext();
  if (!isFieldEntity(entity)) return null;
  return valuesOf(ctx.scope, entity, id);
}

/** Save only the extra fields of one record - from a detail page or drawer. */
export async function saveCustomValuesAction(entity: FieldEntity, id: string, form: FormData): Promise<FieldActionResult> {
  try {
    const ctx = await requireContext();
    if (!isFieldEntity(entity)) return { error: 'Unknown record type.' };
    // Absent for the document entities, which carry no per-record values.
    const permission = EDIT_PERMISSION[entity];
    if (!permission) return { error: 'This record type has no extra fields.' };
    if (!ctx.permissions.has(permission)) return { error: 'You do not have permission to edit this.' };
    const where = { id, ...scopeWhere(ctx.scope) };
    let categoryId: string | null = null;
    if (entity === 'product') {
      const p = await db.product.findFirst({ where, select: { categoryId: true } });
      if (!p) return { error: 'Not found.' };
      categoryId = p.categoryId;
    } else if (entity === 'customer') {
      if (!await db.party.findFirst({ where, select: { id: true } })) return { error: 'Not found.' };
    } else if (!await db.lead.findFirst({ where, select: { id: true } })) {
      return { error: 'Not found.' };
    }
    const { values, error } = await readSubmittedValues(ctx.scope, entity, form, categoryId);
    if (error) return { error };
    await writeValues(entity, id, values);
    return { ok: true };
  } catch (e) {
    console.error('[custom-fields] save values failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}

export async function saveFieldAction(entity: FieldEntity, input: FieldInput, id?: string) {
  return settingsGuard((ctx) => saveField(ctx.scope, entity, input, id));
}

export async function setFieldActiveAction(id: string, isActive: boolean) {
  return settingsGuard((ctx) => setFieldActive(ctx.scope, id, isActive));
}

export async function deleteFieldAction(id: string) {
  return settingsGuard((ctx) => deleteField(ctx.scope, id));
}

export async function moveFieldAction(entity: FieldEntity, id: string, dir: -1 | 1) {
  return settingsGuard((ctx) => moveField(ctx.scope, entity, id, dir));
}

export async function setStandardFieldAction(entity: FieldEntity, key: string, shown: boolean, required: boolean) {
  return settingsGuard((ctx) => setStandardField(ctx.scope, entity, key, shown, required));
}
