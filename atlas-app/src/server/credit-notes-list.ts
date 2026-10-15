import 'server-only';
import { salesReach } from './sales-reach';
import type { AppContext } from './context';
import { listCreditNotes, type CreditNoteRow } from './credit-notes';
import { awaitingApproval } from './approvals';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { inRange, resolveRange } from '@/lib/date-ranges';

/**
 * Credit notes, filtered on the server - shared by the screen (one page at a
 * time) and its export (every page). F1b server paging, 6 Oct 2026; the same
 * filters the screen used to run in the browser.
 *
 * Address: ?card= (issued | applied | unused | draft | cancelled), ?cust=,
 * ?reason=, ?q=, ?sort= &dir=.
 */
type Sp = Record<string, string | undefined>;
export type CreditNoteListRow = CreditNoteRow & { awaitingApproval: boolean };

export const CN_FILTERS: Record<string, (r: CreditNoteListRow) => boolean> = {
  issued: (r) => r.lifecycle === 'issued',
  applied: (r) => r.appliedTo.length > 0,
  draft: (r) => r.lifecycle === 'draft',
  unused: (r) => r.lifecycle === 'issued' && r.unusedPaise > 0,
  cancelled: (r) => r.lifecycle === 'cancelled',
};

export const CN_GRID: PageOptions<CreditNoteListRow> = {
  search: (r) => [r.creditNoteNo, r.invoiceNo, r.returnNo, r.customerName, r.reason],
  sort: {
    no: (r) => r.creditNoteNo, against: (r) => r.invoiceNo, customer: (r) => r.customerName,
    date: (r) => r.creditNoteDate, reason: (r) => r.reason, total: (r) => r.grandTotalPaise,
    applied: (r) => r.appliedTo.length, unused: (r) => r.unusedPaise, status: (r) => r.lifecycle,
  },
};

export interface CreditNoteTotals {
  liveCount: number; issued: number; applied: number; refunded: number; unused: number;
  unusedCount: number; drafts: number; cancelled: number; tax: number;
}

export function creditNoteTotals(rows: CreditNoteListRow[]): CreditNoteTotals {
  const live = rows.filter((r) => r.lifecycle === 'issued');
  const unused = live.filter((r) => r.unusedPaise > 0);
  return {
    liveCount: live.length,
    issued: live.reduce((n, r) => n + r.grandTotalPaise, 0),
    applied: live.reduce((n, r) => n + r.allocatedPaise, 0),
    refunded: live.reduce((n, r) => n + r.refundedPaise, 0),
    unused: unused.reduce((n, r) => n + r.unusedPaise, 0),
    unusedCount: unused.length,
    drafts: rows.filter((r) => r.lifecycle === 'draft').length,
    cancelled: rows.filter((r) => r.lifecycle === 'cancelled').length,
    tax: live.reduce((n, r) => n + r.taxTotalPaise, 0),
  };
}

const distinct = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));

export async function creditNotesList(ctx: AppContext, sp: Sp) {
  // Whose credit notes this person sees - by the invoice's salesperson (B4 step 4).
  const base = await listCreditNotes(ctx.scope, { salesReach: await salesReach(ctx) });
  const held = await awaitingApproval(ctx.scope, base.map((r) => r.id));
  const all: CreditNoteListRow[] = base.map((r) => ({ ...r, awaitingApproval: held.has(r.id) }));

  const card = sp.card && CN_FILTERS[sp.card] ? sp.card : null;
  const customer = sp.cust ?? '';
  const reason = sp.reason ?? '';
  // The date filter (9 Oct 2026). The list follows it; `totals` stay over
  // every note, like Invoices - unused credit does not expire with a month.
  const range = resolveRange({ range: sp.range, from: sp.from, to: sp.to }, 'all');
  const filtered = all.filter((r) => inRange(r.creditNoteDate, range) && (!customer || r.customerName === customer)
    && (!reason || r.reason === reason) && (!card || CN_FILTERS[card](r)));

  return {
    rows: searchAndSort(filtered, parseGridQuery(sp), CN_GRID),
    totals: creditNoteTotals(all),
    customers: distinct(all.map((r) => r.customerName)),
    reasons: distinct(all.map((r) => r.reason)),
    card, customer, reason, rangeLabel: range.label,
  };
}
