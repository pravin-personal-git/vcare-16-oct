/**
 * Lead row shape and derived-metric rules.
 * Pure - no database import, no server-only marker. Shared by the server page
 * and the client list.
 *
 * Spec: 02-leads.md §1.2, §4.9
 */

export interface LeadRow {
  id: string;
  /** Who the lead is assigned to - the Vcare app lists a salesperson's own. */
  assignedToUserId?: string | null;
  leadCode: string;
  businessName: string | null;
  displayName: string;
  mobile: string;
  email: string | null;
  city: string | null;
  state: string | null;
  addressLine1: string | null;
  stageName: string | null;
  stageIsGroupHeader: boolean;
  dealStageName: string | null;
  sourceName: string | null;
  assignedToName: string | null;
  assignedAt: Date | null;
  potentialPaise: number;
  requirement: string | null;
  sinceDate: Date;
  lastTalkAt: Date | null;
  nextActionAt: Date | null;
  isClosed: boolean;
  isWon: boolean;
  convertedCustomerId: string | null;
  convertedAt: Date | null;
  isLost: boolean;
  createdAt: Date;
  tags: string[];
}

export type LeadFilter =
  | 'new' | 'unassigned' | 'contacted' | 'in_progress' | 'meeting'
  | 'due_today' | 'assigned_today' | 'over_due' | 'all' | 'closed' | 'converted';

const sameDay = (a: Date | null, b: Date) =>
  !!a && new Date(a).toDateString() === b.toDateString();

export function matchesFilter(l: LeadRow, f: LeadFilter, now = new Date()): boolean {
  switch (f) {
    case 'all':            return true;
    case 'closed':         return l.isClosed;
    case 'unassigned':     return !l.assignedToName && !l.isClosed;
    case 'new':            return l.stageName === 'New Leads' && !l.isClosed;
    case 'contacted':      return l.stageName === 'Contacted' && !l.isClosed;
    case 'in_progress':    return l.stageName === 'In Progress' && !l.isClosed;
    case 'meeting':        return l.stageName === 'Meeting Scheduled' && !l.isClosed;
    case 'due_today':      return !l.isClosed && sameDay(l.nextActionAt, now);
    // assignedAt, not createdAt. Using creation made this a duplicate of New
    // Leads, and made an unassigned lead created today count as assigned today
    // - the strip showed Unassigned 1 and Assigned Today 1 for the same lead.
    case 'assigned_today': return !l.isClosed && !!l.assignedToName && sameDay(l.assignedAt, now);
    case 'converted':      return !!l.convertedCustomerId;
    case 'over_due':
      return !l.isClosed && !!l.nextActionAt && new Date(l.nextActionAt) < now
        && !sameDay(l.nextActionAt, now);
  }
}

export function summarise(rows: LeadRow[], now = new Date()) {
  const c = (f: LeadFilter) => rows.filter((r) => matchesFilter(r, f, now)).length;
  return {
    new: c('new'), unassigned: c('unassigned'), contacted: c('contacted'),
    in_progress: c('in_progress'), meeting: c('meeting'), due_today: c('due_today'),
    assigned_today: c('assigned_today'), over_due: c('over_due'),
    all: rows.filter((r) => !r.isClosed).length,
    closed: c('closed'),
    converted: c('converted'),
    won_potential_paise: rows.filter((r) => r.convertedCustomerId)
      .reduce((n, r) => n + r.potentialPaise, 0),
    open_potential_paise: rows.filter((r) => !r.isClosed)
      .reduce((n, r) => n + r.potentialPaise, 0),
  };
}

/**
 * Which cards imply looking at closed leads.
 *
 * The list has an Active/Closed toggle AND a set of KPI filter cards. They were
 * applied independently, so clicking "Closed Leads" while the toggle said
 * Active asked for leads that are both open and closed - always empty. The
 * card must win: selecting a closed-only card switches the view for you.
 */
export const CLOSED_ONLY_FILTERS: LeadFilter[] = ['closed', 'converted'];

export function filterImpliesClosed(f: string | null): boolean {
  return f !== null && CLOSED_ONLY_FILTERS.includes(f as LeadFilter);
}

/**
 * Waiting time - how long a lead sat before first contact.
 *
 * Verbatim from the original: "Leads created before this time count from this
 * time; leads created after count from their creation time." So a lead created
 * at 7am with a 09:30 office start has waited zero minutes at 09:30, not two
 * and a half hours.
 *
 * Spec: 02-leads.md §4.9
 */
export function waitingMinutes(
  createdAt: Date,
  officeStartTime: string,
  until: Date = new Date(),
): number {
  const [h, m] = officeStartTime.split(':').map(Number);
  const officeStart = new Date(createdAt);
  officeStart.setHours(h ?? 9, m ?? 30, 0, 0);

  const from = createdAt < officeStart ? officeStart : createdAt;
  return Math.max(0, Math.floor((until.getTime() - from.getTime()) / 60_000));
}
