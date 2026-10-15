'use server';

import { requireContext } from '@/server/context';
import {
  buyerOptions, catalogueOptions, leadOptions, partyOptions, stockProductOptions,
  type BuyerOptionRow, type CatalogueOptionRow, type LeadOptionRow, type PartyOptionRow, type StockProductRow,
} from '@/server/form-options';
import { listSalespeople, type SalespersonOption } from '@/server/salesperson';

/**
 * Picker lists for document forms, fetched when a form opens (PERF-2).
 * Anyone who can raise or view a sales document, receipt or AMC may load
 * them - the same people who saw them embedded in those pages before.
 */
const MAY = ['invoice.create', 'invoice.edit', 'invoice.view', 'quotation.create', 'quotation.edit', 'quotation.view',
  'orders.create', 'orders.edit', 'orders.view', 'accounts.edit', 'accounts.view', 'complaints.edit', 'complaints.view',
  'purchase.edit', 'purchase.view', 'stock.view', 'products.view', 'customers.view'];

export interface FormOptions {
  buyers?: BuyerOptionRow[];
  catalogue?: CatalogueOptionRow[];
  leads?: LeadOptionRow[];
  parties?: PartyOptionRow[];
  stockProducts?: StockProductRow[];
}

export async function loadFormOptions(need: ('buyers' | 'catalogue' | 'leads' | 'parties' | 'stockProducts')[]): Promise<FormOptions> {
  const ctx = await requireContext();
  if (!MAY.some((p) => ctx.permissions.has(p))) return {};
  const [buyers, catalogue, leads, parties, stockProducts] = await Promise.all([
    need.includes('buyers') ? buyerOptions(ctx.scope) : undefined,
    need.includes('catalogue') ? catalogueOptions(ctx.scope) : undefined,
    need.includes('leads') ? leadOptions(ctx.scope) : undefined,
    need.includes('parties') ? partyOptions(ctx.scope) : undefined,
    need.includes('stockProducts') ? stockProductOptions(ctx.scope) : undefined,
  ]);
  return { buyers, catalogue, leads, parties, stockProducts };
}

/**
 * The salesperson dropdown on quotation, order and invoice forms (4 Oct 2026):
 * active people in the current branch, and who is signed in so a new document
 * opens on them.
 */
export async function salespeopleAction(): Promise<{ me: string; people: SalespersonOption[] }> {
  const ctx = await requireContext();
  if (!MAY.some((p) => ctx.permissions.has(p))) return { me: ctx.user.id, people: [] };
  return { me: ctx.user.id, people: await listSalespeople(ctx.scope) };
}
