import 'server-only';
import { visibleComplaintFilter } from './complaint-visibility';
import type { AppContext } from './context';
import { listComplaints, type ComplaintRow } from './complaints';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { isOpenStatus } from '@/lib/job-flow';

/**
 * The Customer Complaints list, filtered - shared by the screen and its export
 * (F1 UI standard), so the file always holds exactly what the screen shows.
 *
 * Filters: status card (?card=), raised date (?range=, default ALL TIME - this
 * is a work queue, and a complaint still open from before April must not drop
 * off it), technician (?person=, 'me' = Assigned to me; the old ?tech= still
 * works for links already shared), and the search box (?q=).
 */

/** `in_progress` = every working step (accepted to off-site); `resolved` = waiting to close (lib/job-flow). */
export const COMPLAINT_CARDS = ['open', 'received', 'assigned', 'in_progress', 'awaiting_customer', 'resolved', 'closed', 'cancelled', 'unassigned', 'urgent'] as const;
export type ComplaintCard = (typeof COMPLAINT_CARDS)[number];

type Sp = Record<string, string | undefined>;

const isOpen = (c: ComplaintRow) => isOpenStatus(c.status);
const WORKING = new Set(['accepted', 'scheduled', 'on_the_way', 'on_site', 'in_progress', 'awaiting_estimate']);
const matchesCard = (c: ComplaintRow, k: ComplaintCard) =>
  k === 'open' ? isOpen(c)
    : k === 'in_progress' ? WORKING.has(c.status)
    : k === 'unassigned' ? !c.assignedTechnicianId && isOpen(c)
      : k === 'urgent' ? (c.priority === 'urgent' || c.priority === 'high') && isOpen(c)
        : c.status === k;

export const COMPLAINT_GRID: PageOptions<ComplaintRow> = {
  search: (c) => [c.complaintNo, c.legacyRef, c.customerName, c.customerPhone, c.productName, c.siteLocation, c.description, c.assignedTechnicianName, c.ownerName],
  sort: {
    complaintNo: (c) => c.complaintNo, createdAt: (c) => c.createdAt, customer: (c) => c.customerName,
    product: (c) => c.productName, status: (c) => c.status, priority: (c) => ({ urgent: 0, high: 1, normal: 2, low: 3 }[c.priority] ?? 2),
    technician: (c) => c.assignedTechnicianName, owner: (c) => c.ownerName, site: (c) => c.siteLocation,
  },
};

export async function complaintsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(
    { ...sp, person: sp.person ?? sp.tech },
    { defaultRange: 'all', meId: ctx.user.id },
  );
  const query = parseGridQuery(sp);
  // A search looks across every status (30 Oct 2026): staff search a customer to
  // FIND which stage the job is in, so the default "Open" card must not hide it.
  // A card picked on purpose (?card=) still narrows the search.
  const card: ComplaintCard | null = (COMPLAINT_CARDS as readonly string[]).includes(sp.card ?? '')
    ? (sp.card as ComplaintCard)
    : query.q ? null : 'open';

  /**
   * `?cat=` - the equipment's category (3 Oct 2026).
   *
   * The screen had status cards and nothing else, so "show me every camera
   * complaint" could not be asked at all. It narrows alongside the date and
   * technician filters, BEFORE the card counts are worked out, so the numbers on
   * the cards always describe the list underneath them.
   */
  const categoryId = (sp.cat ?? '').trim() || null;

  // Same "Complaints they see" rule as the phone app (5 Oct 2026).
  const visible = await visibleComplaintFilter(ctx);
  const all = (await listComplaints(ctx.scope)).filter((c) => !visible || visible(c));
  // The date, person and category filters narrow everything, cards included, so
  // the counts on the cards always add up to what the list can show.
  const inScope = all.filter((c) =>
    inRange(c.createdAt, filters.range)
    && (!filters.personId || c.assignedTechnicianId === filters.personId)
    && (!categoryId || c.productCategoryId === categoryId));
  // While searching, the cards count the matches, so they show which stage each one is in.
  const searched = query.q ? searchAndSort(inScope, query, COMPLAINT_GRID) : inScope;
  const counts = Object.fromEntries(COMPLAINT_CARDS.map((k) => [k, searched.filter((c) => matchesCard(c, k)).length])) as Record<ComplaintCard, number>;

  const rows = card ? searchAndSort(inScope.filter((c) => matchesCard(c, card)), query, COMPLAINT_GRID) : searched;
  /**
   * The categories that actually appear, so the dropdown never offers one with
   * nothing behind it. Taken from `all` rather than `inScope`: narrowing to a
   * category must not then remove every other option and trap somebody there.
   */
  const categories = [...new Map(
    all.filter((c) => c.productCategoryId && c.productCategoryName)
      .map((c) => [c.productCategoryId!, c.productCategoryName!]),
  )].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return { rows, counts, card, filters, query, categories, categoryId, totalAll: all.length };
}
