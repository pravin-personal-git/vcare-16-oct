import 'server-only';
import { visibleAssigneeFilter } from './complaint-visibility';
import type { AppContext } from './context';
import { listLeads } from './leads';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { filterImpliesClosed, matchesFilter, summarise, type LeadFilter, type LeadRow } from '@/lib/lead-metrics';

/**
 * Leads, filtered - shared by the screen and its export (F1).
 *
 * A work queue: "since" date defaults to all time. ?card= is a KPI card
 * (lib/lead-metrics); ?view=closed shows closed leads - a closed-only card
 * implies it, so the two can never ask for a lead that is both.
 */

type Sp = Record<string, string | undefined>;
const CARDS = ['new', 'unassigned', 'contacted', 'in_progress', 'meeting', 'due_today', 'assigned_today', 'over_due', 'all', 'closed', 'converted'];

export const LEAD_GRID: PageOptions<LeadRow> = {
  search: (r) => [r.leadCode, r.businessName, r.displayName, r.mobile, r.email, r.city, r.requirement, r.assignedToName, r.sourceName, ...r.tags],
  sort: {
    leadCode: (r) => r.leadCode, businessName: (r) => r.businessName, displayName: (r) => r.displayName, mobile: (r) => r.mobile,
    stageName: (r) => r.stageName, dealStageName: (r) => r.dealStageName, potential: (r) => r.potentialPaise,
    assignedToName: (r) => r.assignedToName, nextActionAt: (r) => r.nextActionAt, converted: (r) => (r.convertedCustomerId ? 1 : 0),
    sourceName: (r) => r.sourceName, city: (r) => r.city, email: (r) => r.email, lastTalkAt: (r) => r.lastTalkAt, sinceDate: (r) => r.sinceDate,
  },
};

export async function leadsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = CARDS.includes(sp.card ?? '') ? sp.card! : null;
  const closed = filterImpliesClosed(card) || sp.view === 'closed';

  // "Leads they see" (Roles > Phone app) applies on the website too - G-08.
  const visible = await visibleAssigneeFilter(ctx, 'leads');
  const all = (await listLeads(ctx.scope)).filter((r) => !visible || visible(r.assignedToUserId));
  const inScope = all.filter((r) => inRange(r.sinceDate, filters.range) && (!filters.personId || r.assignedToUserId === filters.personId));
  const summary = summarise(inScope);
  let out = inScope.filter((r) => r.isClosed === closed);
  if (card) out = out.filter((r) => matchesFilter(r, card as LeadFilter));
  const rows = searchAndSort(out, parseGridQuery(sp), LEAD_GRID);
  const holderIds = [...new Set(all.map((r) => r.assignedToUserId).filter((x): x is string => !!x))];
  return { rows, summary, card, closed, filters, holderIds };
}
