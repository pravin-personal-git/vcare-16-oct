import 'server-only';
import { db } from './db';
import {
  BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE_ID, builtIn, parseTemplateOptions,
  type DocumentTemplate, type TemplateOptions,
} from '@/lib/document-templates';

/**
 * Which layout a branch prints each document with (workstream C).
 *
 * Falls back to Classic for any branch that has never chosen - so every
 * document prints correctly from the moment Atlas is installed, with no setup
 * step standing between a new client and their first quotation.
 */

export type DocType = 'quotation' | 'invoice' | 'challan';
export const DOC_TYPES: DocType[] = ['quotation', 'invoice', 'challan'];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  challan: 'Delivery challan',
};

export interface ResolvedTemplate {
  templateId: string;
  label: string;
  options: TemplateOptions;
  isCustom: boolean;
}

/** The layout to print this document type with, always resolved to something. */
export async function templateFor(
  storeId: string, docType: DocType,
): Promise<ResolvedTemplate> {
  const row = await db.documentTemplate.findUnique({
    where: { storeId_docType: { storeId, docType } },
    select: { templateId: true, options: true },
  }).catch(() => null);

  const chosen = row?.templateId ?? DEFAULT_TEMPLATE_ID;

  if (chosen === 'custom') {
    return {
      templateId: 'custom',
      label: 'Your own layout',
      // An unset custom layout is still a valid document - it just looks like
      // Classic until the client changes something.
      options: parseTemplateOptions(row?.options),
      isCustom: true,
    };
  }

  const t = builtIn(chosen) ?? builtIn(DEFAULT_TEMPLATE_ID)!;
  return { templateId: t.id, label: t.label, options: t.options, isCustom: false };
}

/** Everything the chooser needs: the built-ins, plus this branch's own. */
export async function templateChoices(storeId: string): Promise<{
  builtIns: DocumentTemplate[];
  custom: TemplateOptions;
  chosen: Record<DocType, string>;
}> {
  const rows = await db.documentTemplate.findMany({
    where: { storeId },
    select: { docType: true, templateId: true, options: true },
  });

  const chosen = Object.fromEntries(
    DOC_TYPES.map((d) => [d, rows.find((r) => r.docType === d)?.templateId ?? DEFAULT_TEMPLATE_ID]),
  ) as Record<DocType, string>;

  // The custom options are shared across document types: a business has one
  // look, applied to whichever documents it chooses.
  const anyCustom = rows.find((r) => r.options);

  return {
    builtIns: [...BUILT_IN_TEMPLATES],
    custom: parseTemplateOptions(anyCustom?.options),
    chosen,
  };
}

export async function saveTemplateChoice(
  storeId: string, docType: DocType, templateId: string,
  options: unknown, userId: string | null,
): Promise<void> {
  const clean = parseTemplateOptions(options);
  const id = templateId === 'custom' || builtIn(templateId) ? templateId : DEFAULT_TEMPLATE_ID;

  await db.documentTemplate.upsert({
    where: { storeId_docType: { storeId, docType } },
    create: {
      storeId, docType, templateId: id,
      options: clean as unknown as object, updatedBy: userId,
    },
    update: {
      templateId: id, options: clean as unknown as object, updatedBy: userId,
    },
  });
}

/**
 * Keep the client's own options on every document type.
 *
 * They are one look, not three: editing the layout under Quotation and then
 * finding Invoice unchanged would be a bug from the client's point of view,
 * whatever the table's shape says.
 */
export async function saveCustomOptions(
  storeId: string, options: unknown, userId: string | null,
): Promise<void> {
  const clean = parseTemplateOptions(options);
  for (const docType of DOC_TYPES) {
    await db.documentTemplate.upsert({
      where: { storeId_docType: { storeId, docType } },
      create: {
        storeId, docType, templateId: DEFAULT_TEMPLATE_ID,
        options: clean as unknown as object, updatedBy: userId,
      },
      update: { options: clean as unknown as object, updatedBy: userId },
    });
  }
}
