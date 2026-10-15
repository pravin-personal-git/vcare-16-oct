/**
 * PER-STORE CUSTOM FIELDS ON A STOCK UNIT - the customisable part of Phase 3.
 *
 * CCTV wants a MAC address and a lens size, a pharmacy wants a storage
 * temperature, a generator dealer wants engine hours. Forty nullable columns
 * that most tenants leave blank is the wrong answer; `ComplaintFieldConfig`
 * already had the right one, and `StockFieldConfig` mirrors it. The values
 * live in one JSON column on the unit.
 *
 * This file is the rule for which fields apply and whether a set of values is
 * acceptable. Pure, so it is shared by the unit screen and the server and
 * tested once.
 */

export const STOCK_FIELD_TYPES = ['text', 'number', 'select', 'boolean', 'date'] as const;
export type StockFieldType = (typeof STOCK_FIELD_TYPES)[number];

export const STOCK_FIELD_TYPE_LABEL: Record<StockFieldType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Choice from a list',
  boolean: 'Yes / no',
  date: 'Date',
};

export interface StockFieldDef {
  fieldKey: string;
  label: string;
  fieldType: string;
  options: string | null;
  required: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Null = applies to every serialised product. */
  categoryId: string | null;
}

export type FieldValue = string | number | boolean | null;

/**
 * A stable key from a label: "MAC address" -> "mac_address".
 *
 * The key is what the JSON is stored under, so it must not change when
 * somebody later corrects the label's spelling - it is derived once, at
 * creation, and never again.
 */
export function fieldKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function selectOptions(def: Pick<StockFieldDef, 'options'>): string[] {
  return (def.options ?? '').split(',').map((o) => o.trim()).filter(Boolean);
}

/**
 * The fields that apply to a product in this category: active ones, either
 * store-wide or for this exact category, in their configured order.
 */
export function fieldsForCategory(defs: StockFieldDef[], categoryId: string | null): StockFieldDef[] {
  return defs
    .filter((d) => d.isActive && (d.categoryId === null || d.categoryId === categoryId))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/**
 * Check and normalise a unit's values against the fields that apply to it.
 *
 * - Unknown keys are dropped, not stored: a value for a field nobody defined
 *   is a value no screen will ever show.
 * - Values for a field that was since deactivated are KEPT - deactivating a
 *   field hides it; it must not destroy what was recorded under it.
 * - Required means required on save; a blank required field is an error.
 * - Numbers are stored as numbers, booleans as booleans, dates as YYYY-MM-DD.
 */
export function validateStockFieldValues(
  applicable: StockFieldDef[],
  allDefs: StockFieldDef[],
  input: Record<string, unknown>,
  previous: Record<string, unknown> = {},
): { values: Record<string, FieldValue>; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, FieldValue> = {};

  // Keep what was recorded under fields that still exist but are switched off.
  for (const d of allDefs) {
    if (!d.isActive && d.fieldKey in previous) values[d.fieldKey] = previous[d.fieldKey] as FieldValue;
  }

  for (const d of applicable) {
    const raw = input[d.fieldKey];
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

    if (blank) {
      if (d.required && d.fieldType !== 'boolean') errors.push(`${d.label} is required.`);
      if (d.fieldType === 'boolean') values[d.fieldKey] = false;
      continue;
    }

    switch (d.fieldType) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
        if (!Number.isFinite(n)) errors.push(`${d.label} must be a number.`);
        else values[d.fieldKey] = n;
        break;
      }
      case 'boolean':
        values[d.fieldKey] = raw === true || raw === 'true' || raw === 'yes' || raw === '1';
        break;
      case 'select': {
        const s = String(raw).trim();
        const opts = selectOptions(d);
        if (opts.length > 0 && !opts.includes(s)) errors.push(`${d.label} must be one of: ${opts.join(', ')}.`);
        else values[d.fieldKey] = s;
        break;
      }
      case 'date': {
        const s = String(raw).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
          errors.push(`${d.label} must be a date.`);
        } else values[d.fieldKey] = s;
        break;
      }
      default: {
        const s = String(raw).trim();
        if (s.length > 200) errors.push(`${d.label} is too long.`);
        else values[d.fieldKey] = s;
      }
    }
  }

  return { values, errors };
}

/** Checks on a field definition itself, before it is saved. */
export function validateFieldDef(d: { label: string; fieldType: string; options: string | null }): string | null {
  if (!d.label.trim()) return 'The field needs a name.';
  if (!fieldKeyFromLabel(d.label)) return 'The name needs at least one letter or number.';
  if (!(STOCK_FIELD_TYPES as readonly string[]).includes(d.fieldType)) return `Unknown field type "${d.fieldType}".`;
  if (d.fieldType === 'select' && selectOptions(d).length < 2) {
    return 'A choice field needs at least two options, separated by commas.';
  }
  return null;
}
