import 'server-only';
import type { AppContext } from './context';
import { listParties } from './parties';
import { inRange } from '@/lib/date-ranges';
import { configFor } from './config';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { matchesFilter, summarise, type PartyFilter, type PartyRow } from '@/lib/party-metrics';

/**
 * Customers, filtered - shared by the screen and its export (F1).
 * Master data: "customer since" defaults to all time. ?card= is a KPI card,
 * ?status=dormant the Active/Dormant switch, ?type= a customer type (by name -
 * the row carries the name), ?city= a city and ?due=due|clear whether anything
 * is owed.
 *
 * City and Balance were added on 4 Oct 2026, in the space freed by taking the
 * staff activity log and the Metrics dialog off this screen. Both were on the
 * toolbar and neither answered a question anybody asks of a customer list.
 */

type Sp = Record<string, string | undefined>;
const CARDS: PartyFilter[] = ['total_due', 'due_date_over', 'cr_days_over', 'crossed_limit', 'no_order_30', 'no_comm_30', 'birthday_week'];

export const CUSTOMER_GRID: PageOptions<PartyRow> = {
  search: (r) => [r.displayName, r.companyName, r.partyCode, r.phone, r.city, r.state, r.email, r.gstin, r.customerTypeName],
  sort: {
    displayName: (r) => r.displayName, partyCode: (r) => r.partyCode, phone: (r) => r.phone, city: (r) => r.city,
    state: (r) => r.state, customerTypeName: (r) => r.customerTypeName, balance: (r) => r.currentBalancePaise,
    creditLimit: (r) => r.creditLimitPaise, lastPurchaseAt: (r) => r.lastPurchaseAt, lastCommunicationAt: (r) => r.lastCommunicationAt,
    rewardPoints: (r) => r.rewardPoints, gstin: (r) => r.gstin, birthday: (r) => r.birthday, customerSince: (r) => r.customerSince,
    addressLine1: (r) => r.addressLine1, email: (r) => r.email,
  },
};

export async function customersList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = CARDS.includes(sp.card as PartyFilter) ? (sp.card as PartyFilter) : null;
  const dormant = sp.status === 'dormant';
  const type = sp.type?.trim() || null;
  const city = sp.city?.trim() || null;
  const due = sp.due === 'due' || sp.due === 'clear' ? sp.due : null;

  const all = await listParties(ctx.scope, 'customer');
  const summary = summarise(all);
  const now = new Date();
  const filtered = all.filter((r) => (r.status === 'active') !== dormant
    && (!card || matchesFilter(r, card, now))
    && (!type || r.customerTypeName === type)
    && (!city || r.city === city)
    && (!due || (due === 'due' ? r.currentBalancePaise > 0 : r.currentBalancePaise <= 0))
    && inRange(r.customerSince, filters.range));
  const found = searchAndSort(filtered, parseGridQuery(sp), CUSTOMER_GRID);

  // web.show.customerPhone (F1a): blanked on the way out, so the number is
  // absent from the payload and from any export of it - not merely unrendered.
  const showPhone = (await configFor(ctx)).on('web.show.customerPhone');
  const rows = showPhone ? found : found.map((r) => ({ ...r, phone: '' }));
  const hidePhone = !showPhone;

  // Only cities somebody is actually in, so the dropdown can never offer a
  // choice that returns nothing.
  const cities = [...new Set(all.map((r) => r.city).filter((c): c is string => Boolean(c?.trim())))].sort((a, b) => a.localeCompare(b));

  return { rows, summary, card, dormant, type, city, due, cities, filters, totalAll: all.length, hidePhone };
}
