import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * Courier & Shipping - the list a quotation or sales order's courier field
 * picks from. Notably absent from the reference app, whose equivalent screen
 * is dead (bug #4 in the do-not-reproduce list: `/courier` just redirects to
 * the dashboard) despite quotations there referencing a courier field.
 */

export class CourierError extends Error {}

export async function listCouriers(scope: StoreScope) {
  const rows = await db.courier.findMany({
    where: scopeWhere(scope),
    orderBy: { name: 'asc' },
  });
  return rows;
}

export interface CourierInput {
  name: string;
  contactPhone: string | null;
  trackingUrlTemplate: string | null;
  notes: string | null;
}

function validate(input: CourierInput) {
  if (!input.name.trim()) throw new CourierError('Courier name is required.');
  if (input.trackingUrlTemplate && !input.trackingUrlTemplate.includes('{awb}')) {
    throw new CourierError('The tracking URL template must contain {awb} as a placeholder for the AWB number.');
  }
}

export async function createCourier(scope: StoreScope, input: CourierInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const dup = await db.courier.findFirst({ where: { storeId, name: input.name.trim() } });
  if (dup) throw new CourierError(`"${input.name.trim()}" is already in the list.`);

  return db.courier.create({
    data: {
      storeId,
      name: input.name.trim(),
      contactPhone: input.contactPhone?.trim() || null,
      trackingUrlTemplate: input.trackingUrlTemplate?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function updateCourier(scope: StoreScope, id: string, input: CourierInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.courier.findFirst({ where: { id, storeId } });
  if (!found) throw new CourierError('That courier is not in your scope.');

  return db.courier.update({
    where: { id },
    data: {
      name: input.name.trim(),
      contactPhone: input.contactPhone?.trim() || null,
      trackingUrlTemplate: input.trackingUrlTemplate?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function setCourierActive(scope: StoreScope, id: string, isActive: boolean) {
  const storeId = scopeForWrite(scope);
  const found = await db.courier.findFirst({ where: { id, storeId } });
  if (!found) throw new CourierError('That courier is not in your scope.');
  return db.courier.update({ where: { id }, data: { isActive } });
}

/** `{awb}` in the template filled in - or null when there's nothing to build a link from. */
export function trackingUrl(template: string | null, awbNo: string | null): string | null {
  if (!template || !awbNo) return null;
  return template.replace('{awb}', encodeURIComponent(awbNo));
}
