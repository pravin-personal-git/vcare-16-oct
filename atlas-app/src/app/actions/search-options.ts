'use server';

import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { searchBuyers, searchLeadOptions, taxChoices } from '@/server/form-options';
import { createTermsTemplate, listTermsTemplates, TermsTemplateError } from '@/server/terms-templates';
import type { SearchOption } from '@/components/ui/SearchSelect';

/**
 * Server search behind the shared SearchSelect picker (health check PERF-2):
 * the 20 best matches for what was typed, scoped to the caller's branch.
 */
const TAKE = 20;
const like = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function searchCustomersAction(q: string): Promise<SearchOption[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(ctx.scope), isCustomer: true, status: 'active',
      ...(s ? { OR: [{ firstName: like(s) }, { lastName: like(s) }, { companyName: like(s) }, { phone: { contains: s } }, { partyCode: like(s) }] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, city: true },
    orderBy: { firstName: 'asc' },
    take: TAKE,
  });
  return rows.map((c) => ({
    id: c.id,
    label: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' '),
    sub: [c.phone, c.city].filter(Boolean).join(' · '),
  }));
}

export async function searchGoodsAction(q: string): Promise<SearchOption[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.product.findMany({
    where: {
      ...scopeWhere(ctx.scope), isActive: true, kind: 'goods',
      ...(s ? { OR: [{ productName: like(s) }, { productCode: like(s) }] } : {}),
    },
    select: { id: true, productName: true, productCode: true, unit: true },
    orderBy: { productName: 'asc' },
    take: TAKE,
  });
  return rows.map((p) => ({ id: p.id, label: p.productName, sub: [p.productCode, p.unit].filter(Boolean).join(' · ') }));
}

export async function searchOpenOrdersAction(q: string): Promise<SearchOption[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.salesOrder.findMany({
    where: {
      ...scopeWhere(ctx.scope), closedAt: null,
      ...(s ? { OR: [{ orderNo: like(s) }, { customerName: like(s) }] } : {}),
    },
    select: { id: true, orderNo: true, customerName: true, orderDate: true },
    orderBy: { orderDate: 'desc' },
    take: TAKE,
  });
  return rows.map((o) => ({ id: o.id, label: `${o.orderNo} - ${o.customerName}`, sub: o.orderDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) }));
}

export async function searchOpenComplaintsAction(q: string): Promise<SearchOption[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.complaint.findMany({
    where: {
      ...scopeWhere(ctx.scope), status: { not: 'closed' },
      ...(s ? { OR: [
        { complaintNo: like(s) }, { legacyRef: like(s) },
        { customer: { OR: [{ firstName: like(s) }, { companyName: like(s) }, { phone: { contains: s } }] } },
      ] } : {}),
    },
    select: { id: true, complaintNo: true, customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take: TAKE,
  });
  return rows.map((c) => ({
    id: c.id, label: c.complaintNo,
    sub: `${c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' ')} · ${c.customer.phone}`,
  }));
}

/**
 * Installation challans a visit can be booked against (7 Oct 2026).
 *
 * `approved` is excluded: an approved challan is finished paperwork, and
 * booking a fitting date for work already signed off is almost always a
 * mistyped challan number. Pending, work-done and rejected all stay, because
 * a rejected challan usually means somebody has to go back.
 */
export async function searchOpenInstallationsAction(q: string): Promise<SearchOption[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.installationChallan.findMany({
    where: {
      ...scopeWhere(ctx.scope),
      status: { not: 'approved' },
      ...(s ? { OR: [
        { challanNo: like(s) }, { legacyRef: like(s) }, { physicalChallanNo: like(s) },
        { salesOrder: { OR: [{ orderNo: like(s) }, { customerName: like(s) }, { phone: { contains: s } }] } },
      ] } : {}),
    },
    select: {
      id: true, challanNo: true, dispatchedAt: true,
      salesOrder: { select: { customerName: true, phone: true } },
      _count: { select: { items: true } },
    },
    orderBy: { dispatchedAt: 'desc' },
    take: TAKE,
  });
  return rows.map((c) => ({
    id: c.id,
    label: c.challanNo,
    sub: [
      c.salesOrder?.customerName ?? 'No order on the challan',
      c.salesOrder?.phone,
      `${c._count.items} item${c._count.items === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · '),
  }));
}

/** Customers for a document's customer picker - the full row, so the form can fill itself in. */
export async function searchBuyersAction(q: string) {
  const ctx = await requireContext();
  return searchBuyers(ctx.scope, q);
}

/** Open leads for the quotation's lead picker - the full row. */
export async function searchLeadOptionsAction(q: string) {
  const ctx = await requireContext();
  return searchLeadOptions(ctx.scope, q);
}

/** GST rates for document lines, from the GST Rates master. */
export async function taxChoicesAction() {
  const ctx = await requireContext();
  return taxChoices(ctx.scope);
}

/**
 * Terms templates for a document form, and whether this person may save a
 * new one from the form. Anyone who can raise a quotation or an order can -
 * the whole point is adding terms on the go; defaults stay an owner's call on
 * the masters screen.
 */
export async function termsTemplatesAction() {
  const ctx = await requireContext();
  const p = ctx.permissions;
  const canSave = ctx.scope.kind === 'single'
    && ['settings.edit', 'quotation.create', 'quotation.edit', 'orders.create', 'orders.edit'].some((k) => p.has(k));
  return { templates: await listTermsTemplates(ctx.scope), canSave };
}

export async function saveTermsTemplateAction(name: string, body: string) {
  const ctx = await requireContext();
  const p = ctx.permissions;
  if (!['settings.edit', 'quotation.create', 'quotation.edit', 'orders.create', 'orders.edit'].some((k) => p.has(k))) {
    return { error: 'You do not have permission to add terms templates.' };
  }
  try {
    return { template: await createTermsTemplate(ctx.scope, { name, body }) };
  } catch (e) {
    if (e instanceof TermsTemplateError) return { error: e.message };
    if (e instanceof Error && /All Company/.test(e.message)) return { error: 'Pick a branch first - templates belong to a branch.' };
    throw e;
  }
}
