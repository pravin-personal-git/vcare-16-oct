import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { phoneInvoiceNumbers } from '@/server/phone-numbers';

/**
 * The invoice numbers this phone may give offline (13 Oct 2026, F-13 Q3 -
 * server/phone-numbers). Asked whenever the phone is online; tops up its
 * block when it is running low. `deviceKey`: the phone's own id, so two
 * phones of one person never hold the same block.
 */
export async function POST(req: Request) {
  return field(req, 'invoice.create', null, async (ctx) => {
    if (ctx.scope.kind !== 'single') throw new V1Error('Choose a branch first.');
    const b = await jsonBody(req);
    const deviceKey = str(b.deviceKey, 80);
    if (!deviceKey) throw new V1Error('This phone did not say who it is.');
    return phoneInvoiceNumbers(ctx.scope.storeId, ctx.user.id, deviceKey);
  });
}
