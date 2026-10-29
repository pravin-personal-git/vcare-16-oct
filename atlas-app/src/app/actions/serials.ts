'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { friendlyError } from '@/lib/friendly-error';
import {
  addDocSerial, changeDocSerial, confirmDocSerial, docSerialCandidates, docSerials, SerialLinkError,
  type DocSerialLine, type SerialDocKind,
} from '@/server/serial-links';

/**
 * Serials on a sale, an order, a return - named, changed or checked after the
 * stock moved (29 Oct 2026). Stock: Edit, like every other change to which
 * unit went where.
 */
type Result<T = object> = ({ ok: true } & T) | { error: string };

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.adjust')) throw new SerialLinkError('Changing a serial needs stock rights (Roles > Stock: Edit).');
  return ctx;
}
const fail = (e: unknown) => ({ error: friendlyError(e, e instanceof SerialLinkError) });
// The pages that show a document's serials read them fresh.
const refresh = () => ['/invoices', '/sales/orders', '/sales-return', '/purchase-return', '/product-journey', '/stock-units', '/reports/stock-health']
  .forEach((p) => revalidatePath(p, 'layout'));

export async function docSerialsAction(kind: SerialDocKind, id: string): Promise<Result<{ lines: DocSerialLine[] }>> {
  try {
    const ctx = await requireContext();
    return { ok: true, lines: (await docSerials(ctx.scope, kind, id)).lines };
  } catch (e) { return fail(e); }
}

export async function docSerialCandidatesAction(kind: SerialDocKind, id: string, productId: string, q: string): Promise<Result<{ units: { id: string; serialNo: string; where: string }[] }>> {
  try {
    const ctx = await guard();
    return { ok: true, units: await docSerialCandidates(ctx.scope, kind, id, productId, q) };
  } catch (e) { return fail(e); }
}

export async function addDocSerialAction(kind: SerialDocKind, id: string, productId: string, unitId: string, reason: string): Promise<Result> {
  try {
    const ctx = await guard();
    await addDocSerial(ctx.scope, kind, id, productId, unitId, reason, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function changeDocSerialAction(kind: SerialDocKind, id: string, fromUnitId: string, toUnitId: string, reason: string): Promise<Result> {
  try {
    const ctx = await guard();
    await changeDocSerial(ctx.scope, kind, id, fromUnitId, toUnitId, reason, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function confirmDocSerialAction(kind: SerialDocKind, id: string, unitId: string): Promise<Result> {
  try {
    const ctx = await guard();
    await confirmDocSerial(ctx.scope, kind, id, unitId, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}
