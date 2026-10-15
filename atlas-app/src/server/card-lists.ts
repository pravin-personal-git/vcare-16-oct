import 'server-only';
import type { AppContext } from './context';
import type { CsvColumn } from '@/lib/csv';
import { filterCards, newestFirst, oldestFirst, pageCards, type CardFilter } from '@/lib/card-list';
import { istDate } from '@/lib/date-ranges';
import { listDisciplinaryActions } from './discipline';
import { listJoiners } from './onboarding';
import { listResignations } from './offboarding';
import { listEncashments, listReimbursements } from './staff-claims';
import { listNotices } from './notices';
import { listHelpdeskTickets } from './helpdesk';
import { listAssets } from './assets';

/**
 * The card lists, paged on the server (F1b, 6 Oct 2026). One definition per
 * list serves both the screen (one page, chip counts over everything) and its
 * export (every page, same filters) - so the file is always what the screen
 * would show across all its pages.
 *
 * `pre` is the screen's own filter that sits outside ListFilter (a status tab,
 * "mine only"); `searchOn` / `chipOf` mirror what the ListFilter on the screen
 * names, on the same address keys (`<paramKey>`, `<paramKey>_c`, `<paramKey>_p`).
 */
type Sp = Record<string, string | undefined>;

export interface CardListDef<T> extends CardFilter<T> {
  route: string;
  title: string;
  paramKey: string;
  load: (ctx: AppContext) => Promise<T[]>;
  pre?: (rows: T[], sp: Sp, ctx: AppContext) => T[];
  columns: CsvColumn<T>[];
}

const def = <T>(d: CardListDef<T>) => d;
const day = (d: Date | string | null | undefined) => (d ? istDate(new Date(d)) : '');
const rs = (p: number | null | undefined) => (p == null ? '' : Math.round(p) / 100);
/**
 * Newest first, then oldest first, by the list's main date (9 Oct 2026). The
 * screen's ListFilter offers the same two keys - `new` and `old` - so the
 * Sort box and the server agree on what each means.
 */
const byDate = <T>(of: (r: T) => Date | string | null | undefined) => [
  { key: 'new', compare: newestFirst(of) },
  { key: 'old', compare: oldestFirst(of) },
];

/** Rows before ListFilter, one page of them, and chip counts over the pre-filtered set. */
export function runCardList<T>(d: CardListDef<T>, all: T[], sp: Sp, ctx: AppContext) {
  const pre = d.pre ? d.pre(all, sp, ctx) : all;
  const page = pageCards(pre, sp, d);
  const chipCounts: Record<string, number> = {};
  if (d.chipOf) for (const r of pre) { const k = d.chipOf(r); chipCounts[k] = (chipCounts[k] ?? 0) + 1; }
  return { ...page, chipCounts, all: all.length };
}

/** Every row the screen would show, across pages - for /api/list-export. */
export async function cardListExport<T>(d: CardListDef<T>, ctx: AppContext, sp: Sp) {
  const all = await d.load(ctx);
  const pre = d.pre ? d.pre(all, sp, ctx) : all;
  return { rows: filterCards(pre, sp, d), columns: d.columns };
}

type Of<F extends (...a: never[]) => Promise<unknown[]>> = Awaited<ReturnType<F>>[number];

export const DISCIPLINE_LIST = def<Of<typeof listDisciplinaryActions>>({
  route: '/hrm/discipline', title: 'Discipline records', paramKey: 'q',
  load: (ctx) => listDisciplinaryActions(ctx.scope),
  searchOn: (a) => [a.userName, a.actionTypeTitle, a.description],
  chipOf: (a) => (a.isCurrentlyBlocking ? 'blocking' : 'other'),
  dates: [{ key: 'from', of: (a) => a.startDate }, { key: 'rec', of: (a) => a.createdAt }],
  sorts: byDate((a) => a.startDate),
  columns: [
    { header: 'Employee', value: (r) => r.userName }, { header: 'Action', value: (r) => r.actionTypeTitle },
    { header: 'From', value: (r) => day(r.startDate) }, { header: 'Details', value: (r) => r.description },
    { header: 'Login blocked', value: (r) => (r.isCurrentlyBlocking ? 'Yes' : '') }, { header: 'Recorded', value: (r) => day(r.createdAt) },
  ],
});

export const ONBOARDING_LIST = def<Of<typeof listJoiners>>({
  route: '/hrm/onboarding', title: 'Onboarding', paramKey: 'q',
  load: (ctx) => listJoiners(ctx.scope),
  searchOn: (j) => [j.fullName, j.employmentType],
  chipOf: (j) => (j.progress.pending > 0 ? 'open' : 'done'),
  dates: [{ key: 'joined', of: (j) => j.dateOfJoining, future: true }, { key: 'confirmed', of: (j) => j.confirmedAt }],
  sorts: byDate((j) => j.dateOfJoining),
  columns: [
    { header: 'Name', value: (r) => r.fullName }, { header: 'Joined', value: (r) => day(r.dateOfJoining) },
    { header: 'Type', value: (r) => r.employmentType }, { header: 'Steps done', value: (r) => `${r.progress.done} of ${r.progress.total}` },
    { header: 'Confirmed', value: (r) => day(r.confirmedAt) },
  ],
});

const offboardingViewer = (ctx: AppContext) => ({
  userId: ctx.user.id, canViewAll: ctx.permissions.has('hrm.view') || ctx.permissions.has('hrm.edit'),
});

export const OFFBOARDING_LIST = def<Of<typeof listResignations>>({
  route: '/hrm/offboarding', title: 'Resignations', paramKey: 'q',
  load: (ctx) => listResignations(ctx.scope, offboardingViewer(ctx)),
  searchOn: (r) => [r.userName, r.reason, r.status, r.decisionNote],
  chipOf: (r) => r.status,
  dates: [{ key: 'resigned', of: (r) => r.resignedOn }, { key: 'last', of: (r) => r.lastWorkingDay, future: true }],
  sorts: byDate((r) => r.resignedOn),
  columns: [
    { header: 'Employee', value: (r) => r.userName }, { header: 'Resigned on', value: (r) => day(r.resignedOn) },
    { header: 'Last day', value: (r) => day(r.lastWorkingDay) }, { header: 'Notice days', value: (r) => r.noticeDays },
    { header: 'Status', value: (r) => r.status }, { header: 'Reason', value: (r) => r.reason },
    { header: 'Completed', value: (r) => day(r.completedAt) },
  ],
});

export const ENCASHMENT_LIST = def<Of<typeof listEncashments>>({
  route: '/hrm/payroll/claims', title: 'Leave encashments', paramKey: 'enc',
  load: (ctx) => listEncashments(ctx.scope),
  searchOn: (e) => [e.userName, e.leaveTypeName, e.status],
  chipOf: (e) => e.status,
  dates: [{ key: 'asked', of: (e) => e.createdAt }],
  sorts: byDate((e) => e.createdAt),
  columns: [
    { header: 'Employee', value: (r) => r.userName }, { header: 'Leave type', value: (r) => r.leaveTypeName },
    { header: 'Days', value: (r) => r.days }, { header: 'Amount (Rs)', value: (r) => rs(r.amountPaise) },
    { header: 'Status', value: (r) => r.status }, { header: 'Asked', value: (r) => day(r.createdAt) },
  ],
});

export const REIMBURSEMENT_LIST = def<Of<typeof listReimbursements>>({
  route: '/hrm/payroll/claims', title: 'Reimbursement claims', paramKey: 'reim',
  load: (ctx) => listReimbursements(ctx.scope),
  searchOn: (r) => [r.userName, r.category, r.status],
  chipOf: (r) => r.status,
  dates: [{ key: 'spent', of: (r) => r.expenseDate }, { key: 'asked', of: (r) => r.createdAt }],
  sorts: byDate((r) => r.expenseDate),
  columns: [
    { header: 'Employee', value: (r) => r.userName }, { header: 'Category', value: (r) => r.category },
    { header: 'Amount (Rs)', value: (r) => rs(r.amountPaise) }, { header: 'Expense date', value: (r) => day(r.expenseDate) },
    { header: 'Description', value: (r) => r.description }, { header: 'Status', value: (r) => r.status },
    { header: 'Asked', value: (r) => day(r.createdAt) },
  ],
});

/** Notices: ?show= active (default) | expired | all, then ListFilter. */
export const NOTICE_LIST = def<Of<typeof listNotices>>({
  route: '/notices', title: 'Notices', paramKey: 'q',
  load: (ctx) => listNotices(ctx.scope, { includeExpired: true }),
  pre: (rows, sp) => rows.filter((n) => (sp.show === 'all' ? true : sp.show === 'expired' ? n.isExpired : !n.isExpired)),
  searchOn: (n) => [n.title, n.body, n.category, n.createdByName],
  chipOf: (n) => n.category,
  dates: [{ key: 'posted', of: (n) => n.createdAt }, { key: 'expires', of: (n) => n.expiresAt, future: true }],
  sorts: byDate((n) => n.createdAt),
  columns: [
    { header: 'Title', value: (r) => r.title }, { header: 'Category', value: (r) => r.category },
    { header: 'Pinned', value: (r) => (r.pinned ? 'Yes' : '') }, { header: 'Posted', value: (r) => day(r.createdAt) },
    { header: 'Expires', value: (r) => day(r.expiresAt) }, { header: 'By', value: (r) => r.createdByName }, { header: 'Text', value: (r) => r.body },
  ],
});

const helpdeskViewer = (ctx: AppContext) => ({
  userId: ctx.user.id, canViewAll: ctx.permissions.has('helpdesk.view') || ctx.permissions.has('helpdesk.edit'),
});

/** Helpdesk: ?status= (a ticket status), ?mine=1, then ListFilter (chip = priority). */
export const HELPDESK_LIST = def<Of<typeof listHelpdeskTickets>>({
  route: '/helpdesk', title: 'Helpdesk tickets', paramKey: 'q',
  load: (ctx) => listHelpdeskTickets(ctx.scope, helpdeskViewer(ctx)),
  pre: (rows, sp, ctx) => rows
    .filter((t) => !sp.status || t.status === sp.status)
    .filter((t) => sp.mine !== '1' || t.raisedById === ctx.user.id),
  searchOn: (t) => [t.ticketNo, t.subject, t.description, t.raisedByName, t.assignedToName, t.categoryName],
  chipOf: (t) => t.priority,
  dates: [{ key: 'raised', of: (t) => t.createdAt }, { key: 'resolved', of: (t) => t.resolvedAt }],
  sorts: byDate((t) => t.createdAt),
  columns: [
    { header: 'Ticket', value: (r) => r.ticketNo }, { header: 'Subject', value: (r) => r.subject },
    { header: 'Category', value: (r) => r.categoryName }, { header: 'Priority', value: (r) => r.priority },
    { header: 'Status', value: (r) => r.status }, { header: 'Raised by', value: (r) => r.raisedByName },
    { header: 'Assigned to', value: (r) => r.assignedToName }, { header: 'Raised', value: (r) => day(r.createdAt) },
    { header: 'Resolved', value: (r) => day(r.resolvedAt) },
  ],
});

/** Assets: ?status= (unassigned | assigned | maintenance | retired), then ListFilter. */
export const ASSET_LIST = def<Of<typeof listAssets>>({
  route: '/assets', title: 'Assets', paramKey: 'q',
  load: (ctx) => listAssets(ctx.scope),
  pre: (rows, sp) => (sp.status ? rows.filter((a) => a.status === sp.status) : rows),
  searchOn: (a) => [a.name, a.assetType, a.serialNumber, a.assignedToName, a.notes],
  dates: [{ key: 'bought', of: (a) => a.purchaseDate }],
  sorts: byDate((a) => a.purchaseDate),
  columns: [
    { header: 'Name', value: (r) => r.name }, { header: 'Type', value: (r) => r.assetType },
    { header: 'Serial no', value: (r) => r.serialNumber }, { header: 'Status', value: (r) => r.status },
    { header: 'Held by', value: (r) => r.assignedToName }, { header: 'Purchased', value: (r) => day(r.purchaseDate) },
    { header: 'Cost (Rs)', value: (r) => rs(r.costPaise) }, { header: 'Notes', value: (r) => r.notes },
  ],
});

/** For /api/list-export: screen key -> definition. */
export const CARD_LISTS = {
  discipline: DISCIPLINE_LIST, onboarding: ONBOARDING_LIST, offboarding: OFFBOARDING_LIST,
  encashments: ENCASHMENT_LIST, reimbursements: REIMBURSEMENT_LIST, notices: NOTICE_LIST,
  helpdesk: HELPDESK_LIST, assets: ASSET_LIST,
} as const;
