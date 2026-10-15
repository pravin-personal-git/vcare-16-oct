/**
 * Document layouts (workstream C, 1 Oct 2026).
 *
 * WHAT WAS THERE: one hardcoded printable quotation. Pravin's decision was
 * "two finished default layouts, plus a third path where the client builds
 * their own".
 *
 * WHAT "BUILD YOUR OWN" MEANS HERE, AND WHY.
 *
 * Not a free-form drag-and-drop designer. A client who can place any element
 * anywhere produces a document that breaks across a page boundary, omits the
 * GSTIN, or pushes the total off the bottom - and then it is our fault,
 * because it is our product that printed it.
 *
 * Instead: every choice that actually varies between businesses is a setting,
 * and the things that must not be got wrong (tax lines, totals, the number)
 * are not negotiable. In practice that is what every client means when they
 * say they want their own layout - their colours, their columns, their terms,
 * their signature block - and it cannot produce an invalid document.
 *
 * Pure module: no database, no React. The same options drive the on-screen
 * preview and the printed page, so what is chosen is what prints.
 */

export type HeaderStyle = 'banner' | 'minimal' | 'centred';
export type Density = 'comfortable' | 'compact';

/** The optional columns. Description, quantity and amount are never optional. */
export type OptionalColumn = 'hsn' | 'rate' | 'discount' | 'tax' | 'srNo' | 'code';

export const COLUMN_LABEL: Record<OptionalColumn, string> = {
  srNo: 'Sr. no.',
  code: 'Product code',
  hsn: 'HSN / SAC',
  rate: 'Unit rate',
  discount: 'Discount',
  tax: 'Tax %',
};

export interface TemplateOptions {
  headerStyle: HeaderStyle;
  density: Density;
  /** Hex. Falls back to the organisation's accent when empty. */
  accentColour: string;
  showLogo: boolean;
  showSeal: boolean;
  showGstin: boolean;
  showBankDetails: boolean;
  showSignature: boolean;
  columns: OptionalColumn[];
  /** Printed above the line items - "Dear Sir, thank you for your enquiry...". */
  coverNote: string;
  /** Printed under the totals. Falls back to the saved Terms when empty. */
  termsOverride: string;
  /** Small print at the very bottom of every page. */
  footerNote: string;
}

export interface DocumentTemplate {
  id: string;
  label: string;
  /** What it looks like, in one line, for the chooser. */
  hint: string;
  /** Built-ins cannot be edited - a client edits a copy. */
  builtIn: boolean;
  options: TemplateOptions;
}

const BASE: TemplateOptions = {
  headerStyle: 'banner',
  density: 'comfortable',
  accentColour: '',
  showLogo: true,
  showSeal: true,
  showGstin: true,
  showBankDetails: true,
  showSignature: true,
  columns: ['srNo', 'hsn', 'rate', 'discount', 'tax'],
  coverNote: '',
  termsOverride: '',
  footerNote: '',
};

/**
 * The two defaults, which must be good enough to use unchanged - Pravin's
 * answer on 1 Oct was explicit about that.
 */
export const BUILT_IN_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: 'classic',
    label: 'Classic',
    hint: 'Coloured header band, logo, every column, bank details and a signature block. The safe choice for a formal quotation.',
    builtIn: true,
    options: { ...BASE },
  },
  {
    id: 'compact',
    label: 'Compact',
    hint: 'Plain header, tighter rows, no bank block. Fits more lines on one page - better for long item lists and for service jobs.',
    builtIn: true,
    options: {
      ...BASE,
      headerStyle: 'minimal',
      density: 'compact',
      showSeal: false,
      showBankDetails: false,
      columns: ['srNo', 'rate', 'tax'],
    },
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

export function builtIn(id: string): DocumentTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

/**
 * Validate options from the database or a form.
 *
 * Never throws, and never half-applies: an unrecognised value falls back to
 * the Classic default for that one field. A document must always print, and
 * printing it slightly plainer than intended is infinitely better than an
 * error where a customer expects a quotation.
 */
export function parseTemplateOptions(v: unknown): TemplateOptions {
  const d = BASE;
  if (!v || typeof v !== 'object') return { ...d };
  const o = v as Record<string, unknown>;

  const headers: HeaderStyle[] = ['banner', 'minimal', 'centred'];
  const densities: Density[] = ['comfortable', 'compact'];
  const allColumns = Object.keys(COLUMN_LABEL) as OptionalColumn[];

  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');

  return {
    headerStyle: headers.includes(o.headerStyle as HeaderStyle) ? (o.headerStyle as HeaderStyle) : d.headerStyle,
    density: densities.includes(o.density as Density) ? (o.density as Density) : d.density,
    // A colour that is not a hex code would end up in a style attribute.
    accentColour: /^#[0-9a-f]{6}$/i.test(String(o.accentColour ?? '')) ? String(o.accentColour) : '',
    showLogo: bool(o.showLogo, d.showLogo),
    showSeal: bool(o.showSeal, d.showSeal),
    showGstin: bool(o.showGstin, d.showGstin),
    showBankDetails: bool(o.showBankDetails, d.showBankDetails),
    showSignature: bool(o.showSignature, d.showSignature),
    columns: Array.isArray(o.columns)
      ? allColumns.filter((c) => (o.columns as unknown[]).includes(c))
      : [...d.columns],
    coverNote: str(o.coverNote, 2000),
    termsOverride: str(o.termsOverride, 8000),
    footerNote: str(o.footerNote, 500),
  };
}

/** Whether a column should be printed. */
export const showsColumn = (t: TemplateOptions, c: OptionalColumn) => t.columns.includes(c);

/**
 * Row padding for the chosen density, as Tailwind classes.
 *
 * Here rather than in the component so the preview and the print path cannot
 * drift apart.
 */
export const rowPadding = (t: TemplateOptions) =>
  (t.density === 'compact' ? 'px-2 py-1' : 'px-3 py-2');
