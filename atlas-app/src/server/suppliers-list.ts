import 'server-only';
import type { AppContext } from './context';
import { listParties } from './parties';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { netPositionPaise, type PartyRow } from '@/lib/party-metrics';

/**
 * Suppliers, filtered - shared by the screen and its export (F1).
 * Master data: no date filter. ?card= both | payable | product | service.
 */

type Sp = Record<string, string | undefined>;

export const SUPPLIER_CARDS: Record<string, (r: PartyRow) => boolean> = {
  payable: (r) => r.payablePaise > 0,
  both: (r) => r.isCustomer && r.isSupplier,
  product: (r) => r.supplierType === 'Product',
  service: (r) => r.supplierType === 'Service',
};

export const SUPPLIER_GRID: PageOptions<PartyRow> = {
  search: (r) => [r.displayName, r.companyName, r.partyCode, r.phone, r.city, r.email, r.gstin, r.supplierType],
  sort: {
    displayName: (r) => r.companyName ?? r.displayName, partyCode: (r) => r.partyCode, supplierType: (r) => r.supplierType,
    phone: (r) => r.phone, city: (r) => r.city, payable: (r) => r.payablePaise, receivable: (r) => r.currentBalancePaise,
    net: (r) => netPositionPaise(r), gstin: (r) => r.gstin,
  },
};

export async function suppliersList(ctx: AppContext, sp: Sp) {
  const card = sp.card && SUPPLIER_CARDS[sp.card] ? sp.card : null;
  const all = await listParties(ctx.scope, 'supplier');
  const counts = {
    all: all.length,
    both: all.filter(SUPPLIER_CARDS.both).length,
    product: all.filter(SUPPLIER_CARDS.product).length,
    service: all.filter(SUPPLIER_CARDS.service).length,
    payablePaise: all.reduce((n, r) => n + Math.max(0, r.payablePaise), 0),
  };
  const rows = searchAndSort(card ? all.filter(SUPPLIER_CARDS[card]) : all, parseGridQuery(sp), SUPPLIER_GRID);
  return { rows, counts, card };
}
