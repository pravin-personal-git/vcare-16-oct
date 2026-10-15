import { field } from '@/server/auth/v1-staff';
import { customersList } from '@/server/customers-list';

/**
 * Customers on the phone (13 Oct 2026, native admin app part 4): the
 * website's list (server/customers-list - the "show customer phone" rule
 * applies), with what is owed. Searched on the phone, so it works offline
 * from the last copy.
 */
export async function GET(req: Request) {
  return field(req, ['customers.view', 'customers.create', 'customers.edit'], null, async (ctx) => {
    const out = await customersList(ctx, { pageSize: '5000' });
    return {
      customers: out.rows.map((r) => ({
        id: r.id, code: r.partyCode, name: r.displayName, company: r.companyName, phone: r.phone, city: r.city,
        gstin: r.gstin, balancePaise: r.currentBalancePaise, creditLimitPaise: r.creditLimitPaise,
        lastPurchaseAt: r.lastPurchaseAt, status: r.status,
      })),
      totalOwedPaise: out.rows.reduce((n, r) => n + Math.max(0, r.currentBalancePaise), 0),
    };
  });
}
