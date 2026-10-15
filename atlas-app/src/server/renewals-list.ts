import 'server-only';
import type { AppContext } from './context';
import { listPolicyRenewals } from './policy-renewals';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Insurance & policy renewals, filtered - shared by the screen and its export
 * (F1). Expiry date defaults to all time. ?card= due | expired | active |
 * inactive (default: active ones, as the screen always opened), ?type=.
 */

type Sp = Record<string, string | undefined>;
type Renewal = Awaited<ReturnType<typeof listPolicyRenewals>>[number];

export const RENEWAL_CARDS: Record<string, (r: Renewal) => boolean> = {
  due: (r) => r.isActive && r.isDue && !r.isOverdue,
  expired: (r) => r.isActive && r.isOverdue,
  active: (r) => r.isActive,
  inactive: (r) => !r.isActive,
};

export const RENEWAL_GRID: PageOptions<Renewal> = {
  search: (r) => [r.title, r.policyType, r.provider, r.policyNumber, r.notes, r.partyName, r.responsibleName],
  sort: { expiry: (r) => r.expiryDate, title: (r) => r.title },
};

export async function renewalsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = sp.card && RENEWAL_CARDS[sp.card] ? sp.card : 'active';
  const type = sp.type?.trim() || null;
  const all = await listPolicyRenewals(ctx.scope);
  const inScope = all.filter((r) => inRange(r.expiryDate, filters.range) && (!type || r.policyType === type));
  const counts = Object.fromEntries(Object.entries(RENEWAL_CARDS).map(([k, fn]) => [k, inScope.filter(fn).length])) as Record<string, number>;
  const query = parseGridQuery(sp);
  // G-27: ?open=<id> (the reminder bell) shows that one policy, whatever card or range is set.
  const opened = sp.open ? all.filter((r) => r.id === sp.open) : [];
  const rows = opened.length ? opened
    : searchAndSort(inScope.filter(RENEWAL_CARDS[card]), { q: query.q, sort: query.sort ?? { key: 'expiry', dir: 'asc' } }, RENEWAL_GRID);
  return { rows, counts, card, type, filters, totalAll: all.length, types: [...new Set(all.map((r) => r.policyType))].sort() };
}
