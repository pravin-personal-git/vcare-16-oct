import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import {
  STANDARD_FIELDS, asCustomValues, fieldKeyFrom, fieldsFor, formatCustomValue, hasOptions, isFieldType, readCustomValues,
  supportsCustomFields,
  type CustomValues, type FieldConfig, type FieldEntity, type FieldSetup, type StandardFieldState,
} from '@/lib/custom-fields';

/**
 * Owner-defined fields on customers, leads and products - the server half
 * (26 Sep 2026). Definitions live in `EntityFieldConfig`, per branch; values in
 * each record's `customFields` JSON. See lib/custom-fields.ts for the types.
 */
export class CustomFieldError extends Error {}

const STD = 'std:';
const ENTITIES: FieldEntity[] = ['customer', 'lead', 'product', 'complaint', 'quotation', 'invoice', 'order'];
export const isFieldEntity = (v: string): v is FieldEntity => (ENTITIES as string[]).includes(v);


/**
 * Custom values live on the record's own `customFields` column, and only
 * three records have one. A document entity reaching here would otherwise
 * fall through the else-chain and write onto a product.
 */
function assertCustom(entity: FieldEntity): asserts entity is 'customer' | 'lead' | 'product' {
  if (!supportsCustomFields(entity)) {
    throw new CustomFieldError(`${entity} has no custom fields - only built-in field rules.`);
  }
}

type Row = Prisma.EntityFieldConfigGetPayload<{ include: { category: { select: { name: true } } } }>;

function toConfig(r: Row): FieldConfig {
  return {
    id: r.id,
    entity: r.entity as FieldEntity,
    fieldKey: r.fieldKey,
    label: r.label,
    fieldType: isFieldType(r.fieldType) ? r.fieldType : 'text',
    options: (r.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean),
    required: r.required,
    showInList: r.showInList,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  };
}

async function rows(scope: StoreScope, entity: FieldEntity) {
  return db.entityFieldConfig.findMany({
    where: { ...scopeWhere(scope), entity },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: { category: { select: { name: true } } },
  });
}

/**
 * What a form shows. In All Company each branch may define its own fields; the
 * first definition of each key wins, so a shared field appears once.
 */
export async function fieldSetup(scope: StoreScope, entity: FieldEntity): Promise<FieldSetup> {
  const all = await rows(scope, entity);
  const seen = new Set<string>();
  const custom: FieldConfig[] = [];
  const standard: FieldSetup['standard'] = {};
  for (const r of all) {
    if (seen.has(r.fieldKey)) continue;
    seen.add(r.fieldKey);
    if (r.fieldKey.startsWith(STD)) standard[r.fieldKey.slice(STD.length)] = { shown: r.isActive, required: r.isActive && r.required };
    else if (r.isActive) custom.push(toConfig(r));
  }
  return { custom, standard };
}

/** The settings screen: every extra field, active or not, plus the built-in switches. */
export async function fieldSettings(scope: StoreScope, entity: FieldEntity) {
  const all = await rows(scope, entity);
  const std = new Map(all.filter((r) => r.fieldKey.startsWith(STD)).map((r) => [r.fieldKey.slice(STD.length), r]));
  const standard: StandardFieldState[] = STANDARD_FIELDS[entity].map((f) => {
    const r = std.get(f.key);
    return { ...f, shown: r ? r.isActive : true, required: r ? r.isActive && r.required : false };
  });
  return { custom: all.filter((r) => !r.fieldKey.startsWith(STD)).map(toConfig), standard };
}

export interface FieldInput {
  label: string;
  fieldType: string;
  options: string[];
  required: boolean;
  showInList: boolean;
  categoryId: string | null;
}

export async function saveField(scope: StoreScope, entity: FieldEntity, input: FieldInput, id?: string) {
  const storeId = scopeForWrite(scope);
  const label = input.label.trim().slice(0, 60);
  if (!label) throw new CustomFieldError('Give the field a name.');
  if (!isFieldType(input.fieldType)) throw new CustomFieldError('Pick a field type.');
  const options = [...new Set(input.options.map((o) => o.trim()).filter(Boolean))];
  if (hasOptions(input.fieldType) && options.length < 1) throw new CustomFieldError('Add at least one choice for the list.');
  if (input.categoryId) {
    const cat = await db.category.findFirst({ where: { id: input.categoryId, storeId }, select: { id: true } });
    if (!cat) throw new CustomFieldError('That category is not in this branch.');
  }
  const data = {
    label,
    fieldType: input.fieldType,
    options: hasOptions(input.fieldType) ? options.join('\n') : null,
    required: input.required,
    showInList: input.showInList,
    categoryId: entity === 'product' ? input.categoryId : null,
  };

  if (id) {
    const row = await db.entityFieldConfig.findFirst({ where: { id, storeId, entity } });
    if (!row || row.fieldKey.startsWith(STD)) throw new CustomFieldError('Field not found.');
    // The key never changes - stored values are filed under it.
    return db.entityFieldConfig.update({ where: { id }, data });
  }

  const base = fieldKeyFrom(label);
  let fieldKey = base;
  for (let n = 2; await db.entityFieldConfig.findFirst({ where: { storeId, entity, fieldKey }, select: { id: true } }); n += 1) {
    fieldKey = `${base}_${n}`;
  }
  const last = await db.entityFieldConfig.aggregate({ where: { storeId, entity }, _max: { sortOrder: true } });
  return db.entityFieldConfig.create({
    data: { storeId, entity, fieldKey, sortOrder: (last._max.sortOrder ?? 0) + 1, ...data },
  });
}

/** Hide or bring back an extra field. Values already typed are kept either way. */
export async function setFieldActive(scope: StoreScope, id: string, isActive: boolean) {
  const storeId = scopeForWrite(scope);
  const row = await db.entityFieldConfig.findFirst({ where: { id, storeId } });
  if (!row) throw new CustomFieldError('Field not found.');
  return db.entityFieldConfig.update({ where: { id }, data: { isActive } });
}

/**
 * Remove a field's definition. Values already stored stay in each record's
 * JSON (harmless, invisible) - so adding a field with the same name brings
 * them back rather than losing them to a mis-click.
 */
export async function deleteField(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const storeId = scopeForWrite(scope);
  const row = await db.entityFieldConfig.findFirst({ where: { id, storeId } });
  if (!row || row.fieldKey.startsWith(STD)) throw new CustomFieldError('Field not found.');
  // Tombstoned, not removed (3 Oct 2026). The VALUES people typed into this field
  // live in `customFields` JSON on each record and are untouched either way; what
  // the tombstone protects is the field definition itself coming back from another
  // machine and asking for data somebody decided not to collect.
  return db.entityFieldConfig.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}

export async function moveField(scope: StoreScope, entity: FieldEntity, id: string, dir: -1 | 1) {
  const storeId = scopeForWrite(scope);
  const list = (await db.entityFieldConfig.findMany({
    where: { storeId, entity, NOT: { fieldKey: { startsWith: STD } } },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true },
  })).map((r) => r.id);
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db.$transaction(list.map((rid, n) => db.entityFieldConfig.update({ where: { id: rid }, data: { sortOrder: n + 1 } })));
}

/** Switch a built-in optional field on or off, or make it mandatory. */
export async function setStandardField(scope: StoreScope, entity: FieldEntity, key: string, shown: boolean, required: boolean) {
  const storeId = scopeForWrite(scope);
  const def = STANDARD_FIELDS[entity].find((f) => f.key === key);
  if (!def) throw new CustomFieldError('Unknown field.');
  const fieldKey = `${STD}${key}`;
  return db.entityFieldConfig.upsert({
    where: { storeId_entity_fieldKey: { storeId, entity, fieldKey } },
    create: { storeId, entity, fieldKey, label: def.label, fieldType: 'standard', isActive: shown, required: shown && required },
    update: { isActive: shown, required: shown && required },
  });
}

/**
 * Check submitted custom values against the branch's definitions. Call before
 * creating the record, so a missing required field stops the save.
 */
export async function readSubmittedValues(
  scope: StoreScope, entity: FieldEntity, form: FormData, categoryId?: string | null,
): Promise<{ values: CustomValues; error?: string }> {
  const setup = await fieldSetup(scope, entity);
  const configs = entity === 'product' ? fieldsFor(setup.custom, categoryId) : setup.custom;
  return readCustomValues(configs, (n) => form.getAll(n).map(String));
}

/** A built-in field the owner made mandatory but the form left empty. */
export async function missingStandard(scope: StoreScope, entity: FieldEntity, form: FormData): Promise<string | null> {
  const { standard } = await fieldSetup(scope, entity);
  for (const f of STANDARD_FIELDS[entity]) {
    if (standard[f.key]?.required && !String(form.get(f.key) ?? '').trim()) return `"${f.label}" is required.`;
  }
  return null;
}

/**
 * Write values onto a record, merged over what it has - keys the form did not
 * cover (a hidden field, another branch's field) are left as they were.
 */
export async function writeValues(entity: FieldEntity, id: string, values: CustomValues) {
  if (!Object.keys(values).length) return;
  assertCustom(entity);
  const read = { select: { customFields: true } } as const;
  const current = entity === 'customer'
    ? await db.party.findUnique({ where: { id }, ...read })
    : entity === 'lead'
      ? await db.lead.findUnique({ where: { id }, ...read })
      : await db.product.findUnique({ where: { id }, ...read });
  const customFields = { ...asCustomValues(current?.customFields), ...values } as Prisma.InputJsonValue;
  if (entity === 'customer') await db.party.update({ where: { id }, data: { customFields } });
  else if (entity === 'lead') await db.lead.update({ where: { id }, data: { customFields } });
  else await db.product.update({ where: { id }, data: { customFields } });
}

/** A record's stored values, scoped - for edit forms and detail pages. */
export async function valuesOf(scope: StoreScope, entity: FieldEntity, id: string): Promise<CustomValues | null> {
  assertCustom(entity);
  const where = { id, ...scopeWhere(scope) };
  const read = { select: { customFields: true } } as const;
  const row = entity === 'customer'
    ? await db.party.findFirst({ where, ...read })
    : entity === 'lead'
      ? await db.lead.findFirst({ where, ...read })
      : await db.product.findFirst({ where, ...read });
  return row ? asCustomValues(row.customFields) : null;
}

/**
 * "Show in list" fields for one page of a list: the columns, and each row's
 * values as display text. Only the rows on screen are read.
 */
export interface ListColumns { columns: { key: string; label: string }[]; values: Record<string, Record<string, string>> }

export async function listColumnValues(scope: StoreScope, entity: FieldEntity, ids: string[]): Promise<ListColumns> {
  assertCustom(entity);
  const { custom } = await fieldSetup(scope, entity);
  const shown = custom.filter((c) => c.showInList);
  if (!shown.length || !ids.length) return { columns: shown.map((c) => ({ key: c.fieldKey, label: c.label })), values: {} };
  const where = { id: { in: ids }, ...scopeWhere(scope) };
  const select = { id: true, customFields: true } as const;
  const rows = entity === 'customer'
    ? await db.party.findMany({ where, select })
    : entity === 'lead'
      ? await db.lead.findMany({ where, select })
      : await db.product.findMany({ where, select });
  const values: ListColumns['values'] = {};
  for (const r of rows) {
    const v = asCustomValues(r.customFields);
    values[r.id] = Object.fromEntries(shown.map((c) => [c.fieldKey, formatCustomValue(c, v[c.fieldKey])]));
  }
  return { columns: shown.map((c) => ({ key: c.fieldKey, label: c.label })), values };
}
