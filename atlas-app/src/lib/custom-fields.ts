/**
 * Owner-defined fields on customers, leads and products (26 Sep 2026).
 *
 * Shared by the settings screen, the forms and the server. A branch owner adds
 * any field of any type from Settings > Custom Fields; values are stored in the
 * record's `customFields` JSON keyed by `fieldKey`. The same screen switches
 * the built-in optional fields (birthday, anniversary, website...) on or off
 * and makes them mandatory - the Vcare meeting's ask, since not every business
 * wants a birthday on every customer.
 */

/**
 * Everything the Field rules screen can configure.
 *
 * The first three also carry owner-defined CUSTOM fields. The rest are
 * document and flow screens where only the BUILT-IN fields are configurable -
 * you cannot invent a new field on a complaint from here, you can only decide
 * whether the ones already there are shown and whether they are mandatory.
 * Complaints keep their own custom fields in `ComplaintFieldConfig`.
 */
export type FieldEntity =
  | 'customer' | 'lead' | 'product' | 'complaint' | 'quotation' | 'invoice' | 'order'
  /** Office Expenses (9 Oct 2026) - a bill number, a vehicle, a meter reading. */
  | 'expense';

/** The three that support owner-defined extra fields. */
export const CUSTOM_FIELD_ENTITIES = ['customer', 'lead', 'product', 'expense'] as const;
export const supportsCustomFields = (e: FieldEntity) => (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(e);
export const FIELD_ENTITIES: { key: FieldEntity; label: string; singular: string }[] = [
  { key: 'customer', label: 'Customers', singular: 'customer' },
  { key: 'lead', label: 'Leads', singular: 'lead' },
  { key: 'product', label: 'Products', singular: 'product' },
  { key: 'complaint', label: 'Complaints', singular: 'complaint' },
  { key: 'quotation', label: 'Quotations', singular: 'quotation' },
  { key: 'order', label: 'Sales orders', singular: 'sales order' },
  { key: 'invoice', label: 'Invoices', singular: 'invoice' },
  { key: 'expense', label: 'Office expenses', singular: 'expense' },
];

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect'
  | 'boolean' | 'phone' | 'email' | 'url';

export const FIELD_TYPES: { key: FieldType; label: string; hint: string }[] = [
  { key: 'text', label: 'Short text', hint: 'One line - a name, a code, a model number' },
  { key: 'textarea', label: 'Long text', hint: 'Several lines - remarks, instructions' },
  { key: 'number', label: 'Number', hint: 'Quantities, amounts, sizes' },
  { key: 'date', label: 'Date', hint: 'Picked from a calendar' },
  { key: 'select', label: 'Dropdown', hint: 'Pick one from a list you define' },
  { key: 'multiselect', label: 'Multiple choice', hint: 'Tick any number from a list you define' },
  { key: 'boolean', label: 'Yes / No', hint: 'A single tick box' },
  { key: 'phone', label: 'Phone number', hint: '10 digits' },
  { key: 'email', label: 'Email', hint: 'Checked for a valid address' },
  { key: 'url', label: 'Web link', hint: 'A website or document link' },
];

export const isFieldType = (v: string): v is FieldType => FIELD_TYPES.some((t) => t.key === v);
export const hasOptions = (t: string) => t === 'select' || t === 'multiselect';

export interface FieldConfig {
  id: string;
  entity: FieldEntity;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  showInList: boolean;
  /** Product fields only. */
  categoryId: string | null;
  categoryName?: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Built-in optional fields an owner can hide or make mandatory. */
/**
 * A built-in field the owner may switch off or make mandatory.
 *
 * `fallback` is decisions D15/D16: a step may not be switched off without
 * saying what happens instead, and a test has to prove the flow still ends.
 *   skip     - the flow carries on without it, nothing else changes
 *   delegate - somebody else supplies it later in the flow
 *   block    - it cannot be switched off at all, only relabelled
 * `note` is shown under the toggle so the person flipping it knows the cost.
 */
export interface StandardFieldDef {
  key: string;
  label: string;
  fallback?: 'skip' | 'delegate' | 'block';
  note?: string;
}
export const STANDARD_FIELDS: Record<FieldEntity, StandardFieldDef[]> = {
  customer: [
    { key: 'companyName', label: 'Company name' },
    { key: 'gstin', label: 'GST number' },
    { key: 'title', label: 'Title (Mr / Mrs...)' },
    { key: 'designation', label: 'Designation' },
    { key: 'altPhone', label: 'Alternative number' },
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'customerTypeId', label: 'Customer type' },
    { key: 'source', label: 'Source' },
    { key: 'birthday', label: 'Birthday' },
    { key: 'weddingAnniversary', label: 'Wedding anniversary' },
    { key: 'addressLine1', label: 'Address' },
    { key: 'pincode', label: 'Pincode' },
  ],
  lead: [
    { key: 'businessName', label: 'Business / company' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'title', label: 'Title (Mr / Mrs...)' },
    { key: 'designation', label: 'Designation' },
    { key: 'altMobile', label: 'Alt mobile' },
    { key: 'email', label: 'Email' },
    { key: 'refCode', label: 'Lead code / reference' },
    { key: 'addressLine1', label: 'Address' },
    { key: 'pincode', label: 'Pincode' },
    { key: 'potential', label: 'Potential (₹)' },
  ],
  // Every built-in product field stays - they feed pricing, stock and GST.
  product: [],

  /**
   * Raising a complaint. The GPS pin is the one Pravin hit on 4 Oct 2026: the
   * Raise button stayed dead until a location was captured, with no way to
   * turn that off, and an office taking a complaint over the phone has no pin
   * to give.
   */
  complaint: [
    {
      key: 'siteLocation',
      label: 'Site location (GPS pin)',
      fallback: 'delegate',
      note: 'Switched off, the complaint is raised without a pin and the technician captures it on arrival. The saved site or the site note carries the address until then.',
    },
    { key: 'productId', label: 'Equipment', fallback: 'skip', note: 'Switched off, the complaint is raised against the customer rather than one machine.' },
    { key: 'siteId', label: 'Site (from saved sites)', fallback: 'skip' },
    { key: 'siteNote', label: 'Site note', fallback: 'skip' },
    { key: 'priority', label: 'Priority', fallback: 'skip', note: 'Switched off, every complaint is raised at Normal.' },
    { key: 'description', label: 'What is wrong', fallback: 'block', note: 'Cannot be switched off. A complaint with no description cannot be worked on.' },
  ],

  /** Document headers. The money fields are never configurable. */
  quotation: [
    { key: 'validityPeriodDays', label: 'Validity (days)', fallback: 'skip' },
    { key: 'salespersonId', label: 'Salesperson', fallback: 'skip' },
    { key: 'notes', label: 'Notes', fallback: 'skip' },
    { key: 'termsBody', label: 'Terms and conditions', fallback: 'skip' },
  ],
  invoice: [
    { key: 'dueDate', label: 'Due date', fallback: 'skip', note: 'Switched off, the invoice is due on the day it is raised.' },
    { key: 'poNumber', label: 'Customer PO number', fallback: 'skip' },
    { key: 'salespersonId', label: 'Salesperson', fallback: 'skip' },
    { key: 'notes', label: 'Notes', fallback: 'skip' },
  ],
  order: [
    { key: 'expectedDeliveryDate', label: 'Expected delivery date', fallback: 'skip' },
    { key: 'poNumber', label: 'Customer PO number', fallback: 'skip' },
    { key: 'salespersonId', label: 'Salesperson', fallback: 'skip' },
    { key: 'notes', label: 'Notes', fallback: 'skip' },
  ],
  /**
   * An expense voucher has no optional built-in fields to switch off - its
   * handful (amount, date, method) are all load-bearing. The entity is here
   * for the OWNER'S OWN fields: a bill number, a vehicle, a meter reading.
   */
  expense: [],
};

/** A field whose fallback is `block` may be relabelled, never switched off. */
export const canSwitchOff = (f: StandardFieldDef) => f.fallback !== 'block';

/** What a complaint form has in it, as far as the rules care. */
export interface ComplaintDraft {
  description: string;
  hasLocation: boolean;
  productId: string;
  siteId: string;
  siteNote: string;
}

/**
 * Why this complaint cannot be raised yet, or null when it can.
 *
 * ONE function, called by the Raise button AND by the save handler.
 *
 * They were two copies of the same condition. On 5 Oct 2026 the rules were
 * wired into the button and the save handler was missed, so the button
 * enabled itself and the save then refused every complaint with "Share the
 * site's location" - which looked exactly like the change had not shipped.
 * A second copy of a rule is a second chance to get it wrong.
 *
 * The server checks again in `createComplaint`; that is deliberate, and a
 * different kind of check. This one is about what the person is told.
 */
export function complaintBlocker(setup: FieldSetup, d: ComplaintDraft): string | null {
  const need = (k: string) => stdShown(setup, k) && stdRequired(setup, k);
  if (!d.description.trim()) return 'Describe what is wrong.';
  if (need('siteLocation') && !d.hasLocation) return 'Share the site’s location or paste a Maps link.';
  if (need('productId') && !d.productId) return 'Choose the equipment.';
  if (need('siteId') && !d.siteId) return 'Choose the site.';
  if (need('siteNote') && !d.siteNote.trim()) return 'Add a site note.';
  return null;
}

export interface StandardFieldState extends StandardFieldDef { shown: boolean; required: boolean }

/** Everything a form needs: the owner's extra fields and the built-in switches. */
export interface FieldSetup {
  custom: FieldConfig[];
  standard: Record<string, { shown: boolean; required: boolean }>;
}

export const EMPTY_SETUP: FieldSetup = { custom: [], standard: {} };

/** Whether a built-in field is on the form. No setting = shown, optional. */
export const stdShown = (setup: FieldSetup, key: string) => setup.standard[key]?.shown ?? true;
export const stdRequired = (setup: FieldSetup, key: string) => setup.standard[key]?.required ?? false;

/** One-click suggestions on the settings screen - the fields businesses most often ask for. */
export const FIELD_PRESETS: Partial<Record<FieldEntity, { label: string; fieldType: FieldType; options?: string[] }[]>> = {
  expense: [
    { label: 'Bill number', fieldType: 'text' },
    { label: 'Vehicle number', fieldType: 'text' },
    { label: 'Meter reading', fieldType: 'number' },
    { label: 'Paid to', fieldType: 'text' },
    { label: 'Bill attached', fieldType: 'boolean' },
  ],
  customer: [
    { label: 'WhatsApp number', fieldType: 'phone' },
    { label: 'Contact person', fieldType: 'text' },
    { label: 'PAN', fieldType: 'text' },
    { label: 'Referred by', fieldType: 'text' },
    { label: 'Preferred language', fieldType: 'select', options: ['Hindi', 'English', 'Chhattisgarhi', 'Marathi'] },
    { label: 'Industry', fieldType: 'select', options: ['Retail', 'Manufacturing', 'Education', 'Healthcare', 'Hospitality', 'Government', 'Residential'] },
    { label: 'Number of sites', fieldType: 'number' },
    { label: 'Preferred visit time', fieldType: 'select', options: ['Morning', 'Afternoon', 'Evening'] },
    { label: 'AMC customer', fieldType: 'boolean' },
    { label: 'Google Maps link', fieldType: 'url' },
  ],
  lead: [
    { label: 'WhatsApp number', fieldType: 'phone' },
    { label: 'Budget (₹)', fieldType: 'number' },
    { label: 'Decision maker', fieldType: 'text' },
    { label: 'Competitor quoted', fieldType: 'text' },
    { label: 'Expected closing date', fieldType: 'date' },
    { label: 'Site visit needed', fieldType: 'boolean' },
    { label: 'Products interested in', fieldType: 'multiselect', options: ['CCTV', 'Biometric', 'Networking', 'Intercom', 'Fire alarm'] },
  ],
  product: [
    { label: 'Model number', fieldType: 'text' },
    { label: 'Resolution', fieldType: 'select', options: ['2 MP', '4 MP', '5 MP', '8 MP'] },
    { label: 'Colour', fieldType: 'text' },
    { label: 'Size / capacity', fieldType: 'text' },
    { label: 'Country of origin', fieldType: 'text' },
    { label: 'Datasheet link', fieldType: 'url' },
    { label: 'Needs installation', fieldType: 'boolean' },
  ],
};

/** The form input name for a custom field. */
export const cfName = (key: string) => `cf_${key}`;

/** A stable key from a label: "WhatsApp number" -> "whatsapp_number". */
export function fieldKeyFrom(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
}

export type CustomValue = string | number | boolean | string[] | null;
export type CustomValues = Record<string, CustomValue>;

/** Which configs apply to a product in a category (null = all products). */
export function fieldsFor(configs: FieldConfig[], categoryId?: string | null): FieldConfig[] {
  return configs.filter((c) => c.isActive && (!c.categoryId || c.categoryId === categoryId));
}

/**
 * Read and check the custom fields from a submitted form. `get` returns every
 * value submitted under a name (multiselect sends several). Returns the values
 * to store or the first problem, worded for the person filling the form.
 */
export function readCustomValues(
  configs: FieldConfig[],
  get: (name: string) => string[],
): { values: CustomValues; error?: string } {
  const values: CustomValues = {};
  for (const c of configs) {
    const raw = get(cfName(c.fieldKey)).map((v) => v.trim()).filter(Boolean);
    const one = raw[0] ?? '';
    let v: CustomValue = null;
    switch (c.fieldType) {
      case 'boolean':
        v = one === 'on' || one === 'true' || one === 'yes';
        if (c.required && !v) return { values, error: `Tick "${c.label}".` };
        values[c.fieldKey] = v;
        continue;
      case 'multiselect':
        v = raw.filter((x) => c.options.includes(x));
        if (c.required && !v.length) return { values, error: `Choose at least one "${c.label}".` };
        values[c.fieldKey] = v.length ? v : null;
        continue;
      case 'number': {
        if (!one) break;
        const n = Number(one.replace(/,/g, ''));
        if (!Number.isFinite(n)) return { values, error: `"${c.label}" must be a number.` };
        v = n;
        break;
      }
      case 'select':
        if (one && !c.options.includes(one)) return { values, error: `Pick "${c.label}" from the list.` };
        v = one || null;
        break;
      case 'phone': {
        const d = one.replace(/\D/g, '');
        if (one && !/^\d{10}$/.test(d.slice(-10)) ) return { values, error: `"${c.label}" must be a 10-digit number.` };
        v = one ? d.slice(-10) : null;
        break;
      }
      case 'email':
        if (one && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(one)) return { values, error: `"${c.label}" is not a valid email.` };
        v = one || null;
        break;
      case 'date':
        if (one && !/^\d{4}-\d{2}-\d{2}$/.test(one)) return { values, error: `"${c.label}" is not a valid date.` };
        v = one || null;
        break;
      case 'url':
        // Only web links - a "javascript:" link shown as clickable is a way in.
        if (one && !/^https?:\/\/\S+$/i.test(one)) return { values, error: `"${c.label}" must start with http:// or https://.` };
        v = one ? one.slice(0, 500) : null;
        break;
      default:
        v = one ? one.slice(0, c.fieldType === 'textarea' ? 4000 : 500) : null;
    }
    if (c.required && (v === null || v === '')) return { values, error: `"${c.label}" is required.` };
    values[c.fieldKey] = v;
  }
  return { values };
}

/** A stored value as text, for detail pages, lists and exports. */
export function formatCustomValue(c: Pick<FieldConfig, 'fieldType'>, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (c.fieldType === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (c.fieldType === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return String(v);
}

/** The stored JSON as an object, whatever shape it came back in. */
export function asCustomValues(json: unknown): CustomValues {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as CustomValues) : {};
}
