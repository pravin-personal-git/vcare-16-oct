import { customer } from '@/server/auth/v1-customer';
import { listMyInvoices } from '@/server/portal';

export async function GET(req: Request) {
  return customer(req, async (c) => ({ invoices: (await listMyInvoices(c.partyId, c.storeId)).slice(0, 100) }));
}
