import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { fitFromVan, myVan } from '@/server/field-app';

/** What this person is carrying. Null when nobody has given them a van. */
export async function GET(req: Request) {
  return field(req, ['stock.view'], 'van', async (ctx) => {
    const van = await myVan(ctx.scope, ctx.user.id);
    return { van };
  });
}

/**
 * Stock fitted at a customer's site, marked from the phone.
 *
 * THIS is the moment stock leaves the business. Loading a van moved it between
 * warehouses and changed nothing on the books; this takes it out, against a
 * job, with the customer's name on it. Until now it could only be done from the
 * office, hours later, from memory.
 */
export async function POST(req: Request) {
  return field(req, ['stock.adjust'], 'van', async (ctx) => {
    const b = await jsonBody(req);
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const lines = raw
      .map((l: Record<string, unknown>) => ({
        productId: String(l.productId ?? ''),
        qty: Number(l.qty ?? 0),
        stockUnitIds: Array.isArray(l.stockUnitIds) ? l.stockUnitIds.map(String) : undefined,
      }))
      .filter((l: { productId: string; qty: number }) =>
        l.productId && Number.isFinite(l.qty) && l.qty > 0);

    if (lines.length === 0) throw new V1Error('Nothing to record.', 400);

    const r = await fitFromVan(ctx.scope, {
      complaintId: str(b.complaintId, 60),
      challanId: str(b.challanId, 60),
      lines,
      note: str(b.note, 500),
    }, ctx.user.id);
    return { ok: true, ...r };
  });
}
