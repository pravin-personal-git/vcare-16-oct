import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';

/**
 * Terms & Conditions templates as a document form uses them (26 Sep 2026).
 *
 * The masters screen owns the templates; this is the read a quotation, order
 * or invoice makes when it opens, plus "save what I just typed as a new
 * template" from inside the form. A template's `defaultFor` says which
 * document types start with it and which product categories suggest it -
 * categories are stored by id ("cat:<id>") and handed to the form by name,
 * because the form's lines only know their category's name.
 */
export type TermsDocType = 'quotation' | 'sales_order' | 'invoice';

export interface TermsTemplateOption {
  id: string;
  name: string;
  body: string;
  /** Document types this is the default for. */
  docTypes: TermsDocType[];
  /** Category names this is the default for. */
  categories: string[];
}

export async function listTermsTemplates(scope: StoreScope): Promise<TermsTemplateOption[]> {
  const where = scopeWhere(scope);
  const [rows, cats] = await Promise.all([
    db.tncTemplate.findMany({
      where: { ...where, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, body: true, defaultFor: true },
    }),
    db.category.findMany({ where: { ...where, parentId: null }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(cats.map((c) => [`cat:${c.id}`, c.name]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    body: r.body,
    docTypes: r.defaultFor.filter((k): k is TermsDocType => ['quotation', 'sales_order', 'invoice'].includes(k)),
    categories: r.defaultFor.map((k) => catName.get(k)).filter((n): n is string => !!n),
  }));
}

export class TermsTemplateError extends Error {}

/** "Save as new template" from a document form. Never a default - that is set on the masters screen. */
export async function createTermsTemplate(scope: StoreScope, input: { name: string; body: string }) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) throw new TermsTemplateError('Give the template a name.');
  if (!body) throw new TermsTemplateError('There is no text to save.');
  const clash = await db.tncTemplate.findFirst({ where: { storeId, name }, select: { id: true } });
  if (clash) throw new TermsTemplateError(`A template called "${name}" already exists.`);
  const row = await db.tncTemplate.create({ data: { storeId, name, body }, select: { id: true, name: true, body: true } });
  return { ...row, docTypes: [] as TermsDocType[], categories: [] as string[] };
}
