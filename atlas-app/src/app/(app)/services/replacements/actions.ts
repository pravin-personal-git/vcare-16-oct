'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createRmaCase, moveRmaCase, addRmaNote, getRmaCase, updateRmaCase, purchaseOrigin, RmaError, type CreateRmaInput, type EditRmaInput,
} from '@/server/rma';
import { StockUnitError } from '@/server/stock-units';
import { friendlyError } from '@/lib/friendly-error';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';

export interface RmaActionState { ok?: boolean; error?: string; message?: string; id?: string }

/**
 * Reading a case is open to the service desk (`complaints.view` - all staff in
 * the migrated tenant, because "where is my camera" is asked of whoever picks
 * up the phone). Changing one needs `complaints.edit`, the permission that
 * already governs moving a complaint along.
 */
async function guard<T>(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<T>): Promise<RmaActionState & { data?: T }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to change replacement cases.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    const data = await run(ctx);
    revalidatePath('/services/replacements');
    revalidatePath('/stock-units');
    return { ok: true, data };
  } catch (err) {
    if (err instanceof RmaError || err instanceof StockUnitError) return { error: err.message };
    console.error('[rma] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createRmaAction(input: CreateRmaInput): Promise<RmaActionState> {
  const r = await guard((ctx) => createRmaCase(ctx.scope, input, ctx.user.id));
  return r.error ? r : { ok: true, id: r.data?.id, message: `${r.data?.caseNo} logged. Send it when it leaves the office.` };
}

export async function moveRmaAction(id: string, input: {
  to: string; supplierId: string | null; supplierName: string | null; serviceCentre: string | null;
  courier: string | null; docketNo: string | null; expectedBackAt: string | null;
  outcome: string | null; replacementSerialNo: string | null; note: string | null;
  creditNoteNo?: string | null; creditAmount?: string | null;
}): Promise<RmaActionState> {
  const r = await guard((ctx) => moveRmaCase(ctx.scope, id, {
    ...input,
    expectedBackAt: input.expectedBackAt ? new Date(`${input.expectedBackAt}T00:00:00+05:30`) : null,
    creditAmountPaise: input.creditAmount ? Math.round(Number(input.creditAmount) * 100) || null : null,
  }, ctx.user.id));
  return r.error ? r : { ok: true, message: r.data?.warning ?? 'Updated.' };
}

export async function updateRmaAction(id: string, input: Omit<EditRmaInput, 'expectedBackAt'> & { expectedBackAt: string | null }): Promise<RmaActionState> {
  const r = await guard((ctx) => updateRmaCase(ctx.scope, id, {
    ...input,
    expectedBackAt: input.expectedBackAt ? new Date(`${input.expectedBackAt}T00:00:00+05:30`) : null,
  }, ctx.user.id));
  return r.error ? r : { ok: true, message: 'Saved.' };
}

export async function addRmaNoteAction(id: string, note: string): Promise<RmaActionState> {
  const r = await guard((ctx) => addRmaNote(ctx.scope, id, note, ctx.user.id));
  return r.error ? r : { ok: true };
}

export async function loadRmaAction(id: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.view') && !ctx.permissions.has('complaints.edit')) return { error: 'No access.' };
    return { detail: JSON.parse(JSON.stringify(await getRmaCase(ctx.scope, id))) as Awaited<ReturnType<typeof getRmaCase>> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the case.' };
  }
}

/** A pick in "Log a faulty item": a serial on file, a product, or "not in the catalogue". */
export interface FaultyPick {
  id: string; label: string; sub?: string | null;
  kind: 'unit' | 'product' | 'none';
  productId: string | null; productName: string;
  stockUnitId?: string; serialNo?: string;
  customerId?: string | null; supplierName?: string | null;
}

/**
 * One box for "Log a faulty item" (27 Oct 2026): type a product name or code,
 * or type / scan a serial. Serials on file come first - a serial pick fills the
 * product, the customer holding it and who it was bought from - then products,
 * then "not in the catalogue". Branch-scoped, best 20.
 */
export async function searchFaultyItemAction(q: string): Promise<FaultyPick[]> {
  const ctx = await requireContext();
  const s = q.trim();
  const like = { contains: s, mode: 'insensitive' as const };
  const where = { ...scopeWhere(ctx.scope) };
  const [units, products] = await Promise.all([
    s.length >= 3
      ? db.stockUnit.findMany({
        where: { ...where, serialNo: like },
        select: {
          id: true, serialNo: true, status: true, storeId: true,
          product: { select: { id: true, productName: true, productCode: true } },
          party: { select: { id: true, isCustomer: true, firstName: true, lastName: true, companyName: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      })
      : Promise.resolve([]),
    db.product.findMany({
      where: { ...where, isActive: true, kind: 'goods', ...(s ? { OR: [{ productName: like }, { productCode: like }] } : {}) },
      select: { id: true, productName: true, productCode: true },
      orderBy: { productName: 'asc' },
      take: 20,
    }),
  ]);
  const origins = await Promise.all(units.map((u) => purchaseOrigin(u.storeId, u.id, null).catch(() => null)));
  const name = (p: { firstName: string | null; lastName: string | null; companyName: string | null }) =>
    p.companyName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(' ');
  const out: FaultyPick[] = units.map((u, i) => {
    const holder = u.party && u.party.isCustomer ? u.party : null;
    const from = origins[i]?.exact ? origins[i]!.supplierName : null;
    return {
      id: `u:${u.id}`, kind: 'unit',
      label: `${u.serialNo} - ${u.product.productName}`,
      sub: ['Serial on file', holder ? `with ${name(holder)}` : u.status.replace(/_/g, ' '), from ? `bought from ${from}` : null].filter(Boolean).join(' · '),
      productId: u.product.id, productName: u.product.productName,
      stockUnitId: u.id, serialNo: u.serialNo ?? undefined,
      customerId: holder?.id ?? null, supplierName: from,
    };
  });
  for (const p of products) {
    out.push({ id: `p:${p.id}`, kind: 'product', label: p.productName, sub: p.productCode, productId: p.id, productName: p.productName });
  }
  out.push({ id: 'none', kind: 'none', label: 'Not in the catalogue - describe it below', sub: null, productId: null, productName: '' });
  return out;
}
