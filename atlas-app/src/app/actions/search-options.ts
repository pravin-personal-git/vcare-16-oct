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
      status: { not: 'approved' }, isInvoiced: false, notBilledReason: null,
      ...(s ? { OR: [
        { challanNo: like(s) }, { legacyRef: like(s) }, { physicalChallanNo: like(s) },
        { salesOrder: { OR: [{ orderNo: like(s) }, { customerName: like(s) }, { phone: { contains: s } }] } },
        { customer: { OR: [{ firstName: like(s) }, { lastName: like(s) }, { companyName: like(s) }, { phone: { contains: s } }] } },
      ] } : {}),
    },
    select: {
      id: true, challanNo: true, dispatchedAt: true,
      customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
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
      (c.customer && (c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '))) || c.salesOrder?.customerName || 'No customer on the challan',
      c.customer?.phone ?? c.salesOrder?.phone,
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

/** A customer for the pickers, with the address the form fills the site from. */
export interface CustomerPick extends SearchOption { address: string | null }

/** Customers with their address - the survey and installation pickers (27 Oct 2026). */
export async function searchCustomersWithAddressAction(q: string): Promise<CustomerPick[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(ctx.scope), isCustomer: true, status: 'active',
      ...(s ? { OR: [{ firstName: like(s) }, { lastName: like(s) }, { companyName: like(s) }, { phone: { contains: s } }, { partyCode: like(s) }] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, city: true, addressLine1: true, partyCode: true },
    orderBy: { firstName: 'asc' },
    take: TAKE,
  });
  return rows.map((c) => ({
    id: c.id,
    label: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' '),
    sub: [c.phone, c.partyCode, c.city].filter(Boolean).join(' · '),
    address: c.addressLine1,
  }));
}

/**
 * A new customer from a picker, in three fields (27 Oct 2026, Vcare): a survey
 * or a fitting is often for somebody not on file yet. Same phone already on
 * file: that customer is used instead of a second record.
 */
export async function quickAddCustomerAction(input: { name: string; phone: string; address: string | null }): Promise<{ error?: string; customer?: CustomerPick }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('customers.create')) return { error: 'You do not have permission to add customers.' };
  if (ctx.scope.kind !== 'single') return { error: 'Select a single branch first.' };
  const name = input.name.trim();
  const phone = input.phone.replace(/\D/g, '').slice(-10);
  if (!name) return { error: 'Type the customer’s name.' };
  if (phone.length !== 10) return { error: 'Type a 10-digit phone number.' };
  const pick = (p: { id: string; firstName: string; lastName: string | null; companyName: string | null; phone: string; addressLine1: string | null }) => ({
    id: p.id, label: p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' '), sub: p.phone, address: p.addressLine1,
  });
  const existing = await db.party.findFirst({
    where: { ...scopeWhere(ctx.scope), isCustomer: true, phone },
    select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, addressLine1: true },
  });
  if (existing) return { customer: pick(existing) };
  try {
    const { createParty } = await import('@/server/parties');
    const [first, ...rest] = name.split(/\s+/);
    const { party } = await createParty(ctx.scope, {
      isCustomer: true, isSupplier: false, supplierType: null, paymentTermsDays: 0,
      companyName: null, gstin: null, title: null, firstName: first ?? name, lastName: rest.join(' ') || null,
      designation: null, phone, altPhone: null, email: null, website: null, customerTypeId: null, source: null,
      birthday: null, weddingAnniversary: null, addressLine1: input.address?.trim() || null, state: null, city: null, pincode: null,
      deliveryAddress: null, deliverySameAsBilling: true, creditLimitPaise: 0, creditLimitDays: 0, subscribeSms: false,
    });
    await db.activityLog.create({
      data: { storeId: party.storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'Party', entityId: party.id, description: `Customer '${name}' added from a picker (${party.partyCode})` },
    }).catch(() => undefined);
    return { customer: pick(party) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add the customer.' };
  }
}

/** A customer's surveys not yet on a challan - "From a survey" on the raise form (27 Oct 2026). */
export async function customerSurveysAction(customerId: string): Promise<{ id: string; label: string }[]> {
  const ctx = await requireContext();
  const rows = await db.serviceVisit.findMany({
    where: { ...scopeWhere(ctx.scope), customerId, reason: 'installation_survey', installationChallanId: null, status: { not: 'cancelled' } },
    select: { id: true, scheduledAt: true, status: true, technician: { select: { fullName: true } } },
    orderBy: { scheduledAt: 'desc' },
    take: TAKE,
  });
  return rows.map((v) => ({
    id: v.id,
    label: `Survey ${v.scheduledAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${v.technician.fullName}${v.status === 'completed' ? ' · done' : ''}`,
  }));
}
