/**
 * The column definitions for Import Data - shared between the browser (to
 * build the downloadable template and label the preview table) and the
 * server (to actually match and validate). Pure and DB-free on purpose: the
 * template a client downloads must be generated from the exact same list the
 * server matches against, or the file it downloads will not import cleanly.
 */

export type ImportTarget = 'customers' | 'products';

/** Never accepted at once - a spreadsheet this size wants a proper migration, not a paste. */
export const MAX_IMPORT_ROWS = 2000;

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const CUSTOMER_FIELDS: FieldSpec[] = [
  { key: 'firstName', label: 'First Name', required: true, aliases: ['first name', 'firstname', 'name', 'customer name'] },
  { key: 'lastName', label: 'Last Name', aliases: ['last name', 'lastname', 'surname'] },
  { key: 'phone', label: 'Phone', required: true, aliases: ['phone', 'mobile', 'phone number', 'contact', 'contact number'] },
  { key: 'companyName', label: 'Company', aliases: ['company', 'company name', 'organisation', 'organization'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address'] },
  { key: 'gstin', label: 'GSTIN', aliases: ['gstin', 'gst no', 'gst number'] },
  { key: 'addressLine1', label: 'Address', aliases: ['address', 'address line 1', 'billing address'] },
  { key: 'city', label: 'City', aliases: ['city'] },
  { key: 'state', label: 'State', aliases: ['state'] },
  { key: 'pincode', label: 'Pincode', aliases: ['pincode', 'pin', 'pin code', 'zip'] },
  { key: 'customerType', label: 'Customer Type', aliases: ['customer type', 'type'] },
  { key: 'creditLimit', label: 'Credit Limit (₹)', aliases: ['credit limit', 'credit limit (₹)', 'credit limit rs'] },
  { key: 'creditDays', label: 'Credit Days', aliases: ['credit days'] },
];

export const PRODUCT_FIELDS: FieldSpec[] = [
  { key: 'productName', label: 'Product Name', required: true, aliases: ['product name', 'name', 'item name'] },
  { key: 'category', label: 'Category', aliases: ['category'] },
  { key: 'brand', label: 'Brand', aliases: ['brand'] },
  { key: 'hsnCode', label: 'HSN Code', aliases: ['hsn code', 'hsn'] },
  { key: 'sku', label: 'SKU', aliases: ['sku'] },
  { key: 'barcode', label: 'Barcode', aliases: ['barcode'] },
  { key: 'unit', label: 'Unit', required: true, aliases: ['unit', 'uom', 'unit of measure'] },
  { key: 'mrp', label: 'MRP (₹)', required: true, aliases: ['mrp', 'mrp (₹)', 'mrp rs'] },
  { key: 'dlp', label: 'DLP (₹)', aliases: ['dlp', 'dlp (₹)'] },
  { key: 'retail', label: 'Retail Price (₹)', aliases: ['retail price', 'retail', 'retail (₹)'] },
  { key: 'wholesale', label: 'Wholesale Price (₹)', aliases: ['wholesale price', 'wholesale'] },
  { key: 'taxRate', label: 'Tax Rate %', aliases: ['tax rate', 'tax rate %', 'gst %', 'gst rate'] },
  { key: 'openingQty', label: 'Opening Qty', aliases: ['opening qty', 'opening quantity', 'opening stock'] },
  { key: 'reorderLevel', label: 'Reorder Level', aliases: ['reorder level', 'reorder qty'] },
];

export function fieldsFor(target: ImportTarget): FieldSpec[] {
  return target === 'customers' ? CUSTOMER_FIELDS : PRODUCT_FIELDS;
}

/** The literal, best-cased header a client should see in the template - not the normalised form used for matching. */
export function templateHeaders(target: ImportTarget): string[] {
  return fieldsFor(target).map((f) => f.label);
}

/** Which raw (already-normalised) header satisfies each field, if any. First matching column wins. */
export function matchColumns(headers: string[], fields: FieldSpec[]) {
  return fields.map((f) => ({
    field: f.key,
    column: headers.find((h) => f.aliases.includes(h)) ?? null,
  }));
}

export function pick(
  row: Record<string, string>, match: { field: string; column: string | null }[], field: string,
): string {
  const column = match.find((m) => m.field === field)?.column;
  return column ? (row[column] ?? '').trim() : '';
}

export function money(raw: string): number {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function int(raw: string, fallback = 0): number {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
