import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';

/**
 * One customer, ready to drop into a form (G-39, 10 Oct 2026). The customer
 * page's New quotation and Raise complaint open those forms with the
 * customer already chosen, through `?customer=<id>` / `?raise=<id>`. Looked
 * up in the viewer's branches only - an id from elsewhere fills nothing.
 */
export async function customerPrefill(scope: StoreScope, id: string | undefined) {
  if (!id) return null;
  const p = await db.party.findFirst({
    where: { id, ...scopeWhere(scope), isCustomer: true },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true, companyName: true,
      phoneCc: true, phone: true, email: true, gstin: true, state: true, city: true, addressLine1: true,
    },
  });
  if (!p) return null;
  const name = [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return {
    id: p.id,
    name,
    company: p.companyName,
    phone: p.phone,
    email: p.email,
    gstin: p.gstin,
    state: p.state,
    city: p.city,
    address: p.addressLine1,
    /** As a SearchSelect option. */
    label: p.companyName ? `${p.companyName} (${name})` : name,
    sub: `${p.partyCode} · ${p.phoneCc ?? '+91'} ${p.phone}`,
  };
}
export type CustomerPrefill = NonNullable<Awaited<ReturnType<typeof customerPrefill>>>;
