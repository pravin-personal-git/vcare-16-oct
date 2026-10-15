import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { createParty, type PartyInput } from './parties';
import { createProduct, type ProductInput } from './products';
import {
  CUSTOMER_FIELDS, PRODUCT_FIELDS, matchColumns, pick, money, int,
} from '@/lib/import-fields';

export type { ImportTarget } from '@/lib/import-fields';
export { MAX_IMPORT_ROWS, templateHeaders } from '@/lib/import-fields';

/**
 * Settings → Import Data.
 *
 * "Bring customers, products and leads in from a spreadsheet" is the promise
 * in the catalogue this replaces; this ships two of the three - the two most
 * asked-for when a client is migrating off a previous system. Leads have
 * their own assignment and round-robin rules (A045) and are left for a
 * separate pass rather than bolted on here.
 *
 * DELIBERATELY NO MANUAL COLUMN-MAPPING UI. A column is matched to a field by
 * its header text (case- and whitespace-insensitive, with a short alias
 * list in `lib/import-fields.ts`), not by position. Downloading the template
 * and filling it in is the happy path; a drag-and-drop mapper is real scope
 * for a feature nobody has asked to remap yet.
 *
 * TWO STEPS, NEVER ONE. `dryRun*` never writes - it exists so a client sees
 * every row's fate (import, or the exact reason it would not) before a single
 * record is created. `commit*` then creates only the rows that pass, one at a
 * time rather than in a single transaction, because a 500-row import where
 * row 340 fails on a duplicate phone should keep the 339 good ones rather
 * than discard them along with it - the per-row report is what makes that
 * safe to do.
 */

export interface RowResult {
  /** 1-based, and counting the header - what the client sees when they open the file in a spreadsheet program. */
  line: number;
  ok: boolean;
  /** A short label for the row - the name that would be created, or "(row 4)" if there is none to show yet. */
  summary: string;
  errors: string[];
  notes: string[];
}

export interface DryRunReport {
  headers: string[];
  matched: { field: string; column: string | null }[];
  missingRequired: string[];
  rows: RowResult[];
  validCount: number;
}

export interface ImportOutcome {
  line: number;
  ok: boolean;
  summary: string;
  error?: string;
  /** e.g. the assigned P-00042 / CAM-00042 code, for the confirmation list. */
  code?: string;
}

// --------------------------------------------------------------- customers

export async function dryRunCustomers(
  scope: StoreScope, headers: string[], rows: Record<string, string>[],
): Promise<DryRunReport> {
  const match = matchColumns(headers, CUSTOMER_FIELDS);
  const missingRequired = CUSTOMER_FIELDS
    .filter((f) => f.required && !match.find((m) => m.field === f.key)?.column)
    .map((f) => f.label);

  const types = await db.customerType.findMany({ where: scopeWhere(scope), select: { name: true } });
  const typeNames = new Set(types.map((t) => t.name.toLowerCase()));

  const results: RowResult[] = [];
  const seenPhones = new Map<string, number>(); // phone -> first line it appeared on, within this file

  rows.forEach((row, idx) => {
    const line = idx + 2; // header is line 1
    const errors: string[] = [];
    const notes: string[] = [];

    const firstName = pick(row, match, 'firstName');
    const phone = pick(row, match, 'phone').replace(/[^\d]/g, '');
    const customerType = pick(row, match, 'customerType');

    if (!firstName) errors.push('First Name is required.');
    if (!phone) errors.push('Phone is required.');
    else if (phone.length < 10) errors.push(`Phone "${phone}" is too short to be valid.`);

    if (phone) {
      const firstLine = seenPhones.get(phone);
      if (firstLine) errors.push(`Same phone number as row ${firstLine} in this file.`);
      else seenPhones.set(phone, line);
    }

    if (customerType && !typeNames.has(customerType.toLowerCase())) {
      notes.push(`Customer Type "${customerType}" is not one of your masters - left blank.`);
    }

    results.push({
      line,
      ok: errors.length === 0,
      summary: [firstName, pick(row, match, 'lastName')].filter(Boolean).join(' ') || `(row ${line})`,
      errors,
      notes,
    });
  });

  return {
    headers,
    matched: match,
    missingRequired,
    rows: results,
    validCount: results.filter((r) => r.ok).length,
  };
}

export async function commitCustomers(
  scope: StoreScope, headers: string[], rows: Record<string, string>[],
): Promise<ImportOutcome[]> {
  const match = matchColumns(headers, CUSTOMER_FIELDS);
  if (scope.kind !== 'single') throw new Error('Select a single store before importing - All Company is read-only.');

  const types = await db.customerType.findMany({ where: scopeWhere(scope), select: { id: true, name: true } });
  const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t.id]));

  const out: ImportOutcome[] = [];
  for (const [idx, row] of rows.entries()) {
    const line = idx + 2;
    const firstName = pick(row, match, 'firstName');
    const phone = pick(row, match, 'phone').replace(/[^\d]/g, '');
    const summary = [firstName, pick(row, match, 'lastName')].filter(Boolean).join(' ') || `(row ${line})`;

    if (!firstName || !phone) {
      out.push({ line, ok: false, summary, error: 'Missing First Name or Phone.' });
      continue;
    }

    const input: PartyInput = {
      isCustomer: true,
      isSupplier: false,
      supplierType: null,
      paymentTermsDays: 0,
      companyName: pick(row, match, 'companyName') || null,
      gstin: pick(row, match, 'gstin') || null,
      title: null,
      firstName,
      lastName: pick(row, match, 'lastName') || null,
      designation: null,
      phone,
      altPhone: null,
      email: pick(row, match, 'email') || null,
      website: null,
      customerTypeId: typeByName.get(pick(row, match, 'customerType').toLowerCase()) ?? null,
      source: 'CSV import',
      birthday: null,
      weddingAnniversary: null,
      addressLine1: pick(row, match, 'addressLine1') || null,
      state: pick(row, match, 'state') || null,
      city: pick(row, match, 'city') || null,
      pincode: pick(row, match, 'pincode') || null,
      deliveryAddress: null,
      deliverySameAsBilling: true,
      creditLimitPaise: money(pick(row, match, 'creditLimit') || '0'),
      creditLimitDays: int(pick(row, match, 'creditDays')),
      subscribeSms: false,
    };

    try {
      const { party } = await createParty(scope, input);
      out.push({ line, ok: true, summary, code: party.partyCode });
    } catch (err) {
      out.push({ line, ok: false, summary, error: err instanceof Error ? err.message : 'Could not create this row.' });
    }
  }
  return out;
}

// ----------------------------------------------------------------- products

export async function dryRunProducts(
  scope: StoreScope, headers: string[], rows: Record<string, string>[],
): Promise<DryRunReport> {
  const match = matchColumns(headers, PRODUCT_FIELDS);
  const missingRequired = PRODUCT_FIELDS
    .filter((f) => f.required && !match.find((m) => m.field === f.key)?.column)
    .map((f) => f.label);

  const [categories, brands] = await Promise.all([
    db.category.findMany({ where: scopeWhere(scope), select: { name: true } }),
    db.brand.findMany({ where: scopeWhere(scope), select: { name: true } }),
  ]);
  const categoryNames = new Set(categories.map((c) => c.name.toLowerCase()));
  const brandNames = new Set(brands.map((b) => b.name.toLowerCase()));

  const results: RowResult[] = [];

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const errors: string[] = [];
    const notes: string[] = [];

    const productName = pick(row, match, 'productName');
    const unit = pick(row, match, 'unit');
    const mrpRaw = pick(row, match, 'mrp');
    const category = pick(row, match, 'category');
    const brand = pick(row, match, 'brand');

    if (!productName) errors.push('Product Name is required.');
    if (!unit) errors.push('Unit is required.');
    if (!mrpRaw) errors.push('MRP is required.');
    else if (money(mrpRaw) <= 0) errors.push(`MRP "${mrpRaw}" is not a positive amount.`);

    if (category && !categoryNames.has(category.toLowerCase())) {
      notes.push(`Category "${category}" is not one of your masters - the product code falls back to GEN- and no category is set.`);
    }
    if (brand && !brandNames.has(brand.toLowerCase())) {
      notes.push(`Brand "${brand}" is not one of your masters - left blank.`);
    }

    results.push({
      line, ok: errors.length === 0, summary: productName || `(row ${line})`, errors, notes,
    });
  });

  return {
    headers, matched: match, missingRequired, rows: results, validCount: results.filter((r) => r.ok).length,
  };
}

export async function commitProducts(
  scope: StoreScope, headers: string[], rows: Record<string, string>[],
): Promise<ImportOutcome[]> {
  const match = matchColumns(headers, PRODUCT_FIELDS);
  if (scope.kind !== 'single') throw new Error('Select a single store before importing - All Company is read-only.');

  const [categories, brands] = await Promise.all([
    db.category.findMany({ where: scopeWhere(scope), select: { id: true, name: true } }),
    db.brand.findMany({ where: scopeWhere(scope), select: { id: true, name: true } }),
  ]);
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

  const out: ImportOutcome[] = [];
  for (const [idx, row] of rows.entries()) {
    const line = idx + 2;
    const productName = pick(row, match, 'productName');
    const unit = pick(row, match, 'unit');
    const mrpPaise = money(pick(row, match, 'mrp'));

    if (!productName || !unit || mrpPaise <= 0) {
      out.push({ line, ok: false, summary: productName || `(row ${line})`, error: 'Missing Product Name, Unit, or a valid MRP.' });
      continue;
    }

    const dlpPaise = money(pick(row, match, 'dlp')) || mrpPaise;
    const input: ProductInput = {
      productName,
      categoryId: categoryByName.get(pick(row, match, 'category').toLowerCase()) ?? null,
      subCategoryId: null,
      brandId: brandByName.get(pick(row, match, 'brand').toLowerCase()) ?? null,
      hsnCode: pick(row, match, 'hsnCode') || null,
      sku: pick(row, match, 'sku') || null,
      barcode: pick(row, match, 'barcode') || null,
      location: null,
      unit,
      mrpPaise,
      dlpPaise,
      retailPaise: money(pick(row, match, 'retail')) || dlpPaise,
      wholesalePaise: money(pick(row, match, 'wholesale')) || dlpPaise,
      costPaise: 0,
      taxRatePct: (() => { const n = Number(pick(row, match, 'taxRate')); return Number.isFinite(n) ? n : 18; })(),
      openingQty: int(pick(row, match, 'openingQty')),
      reorderLevel: int(pick(row, match, 'reorderLevel')),
      isRateEditable: true,
      /**
       * Warranty and AMC are NOT importable, on purpose.
       *
       * The bulk template has no column for them, and inventing one would mean
       * guessing. A wrong warranty period or a wrong AMC price is worse than a
       * blank: it makes the coverage rule confidently tell a technician that a
       * customer is covered when they are not, or bill somebody who is. Both
       * are set per product from the Products screen, deliberately by a person.
       */
      warrantyMonths: null,
      amcAvailable: false,
      amcPricingMode: null,
      amcDurationMonths: null,
      amcAnnualPricePaise: null,
      amcTerms: null,
      // An import never turns expiry tracking on. The spreadsheet has no column
      // for it, and defaulting it from a product's name would guess at which
      // items spoil - on a 1,300-row catalogue that is a lot of wrong dates.
      tracksExpiry: false,
      shelfLifeDays: null,
      expiryWarnDays: null,
    };

    try {
      const product = await createProduct(scope, input);
      out.push({ line, ok: true, summary: productName, code: product.productCode });
    } catch (err) {
      out.push({ line, ok: false, summary: productName, error: err instanceof Error ? err.message : 'Could not create this row.' });
    }
  }
  return out;
}
