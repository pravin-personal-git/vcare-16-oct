import { isJobStatus, officeLabel, WORKING_STATUSES, type JobStatus } from './job-flow';

/**
 * THE STATUS OF AN INSTALLATION = A COMPLAINT'S (30 Oct 2026, Vcare). The
 * `stage` column holds a job status code from lib/job-flow, so the names,
 * colours and the rulebook (TRANSITIONS) are one set for both job types.
 *
 * What happens still moves it on by itself (`autoStatus`): naming the team,
 * booking a visit, checking in at the site, Work done, billing. The rest are
 * the complaint's own steps - Accept, On the way, the customer's code, and
 * the office's status picker. Billing (or Don't bill) is the installation's
 * Close.
 *
 * Older keys - the 27 Oct stages and the 11 Oct ones - read through
 * `normaliseStage` until the challan is next touched.
 */

/** The steps shown in order on the page; the side states sit on one of them. */
export const INSTALL_STAGES = ([
  ['received', 'Name the technicians who go.'],
  ['assigned', 'The technician accepts the job on the phone.'],
  ['accepted', 'Book the installation visit.'],
  ['scheduled', 'The technician taps On the way, then Working on site.'],
  ['on_the_way', 'The technician taps Working on site at the site.'],
  ['on_site', 'Fit each unit; the technician taps Work done on the phone.'],
  ['awaiting_customer', 'The customer gives the technician their code.'],
  ['resolved', 'Bill this installation - or Don’t bill, with a reason.'],
  ['closed', 'Done.'],
] as const).map(([key, next]) => ({ key, label: officeLabel(key), next }));

export type InstallStage = JobStatus;

/** Old keys, for challans not touched since. Old Work done was waiting for its bill: Waiting to close. */
const OLD: Record<string, JobStatus> = {
  raised: 'received', technician: 'assigned', visit: 'scheduled', fitting: 'on_site', work_done: 'resolved', billed: 'closed',
  planned: 'received', survey: 'assigned', material_ready: 'on_site', installing: 'on_site',
  testing: 'resolved', handover: 'resolved', approved: 'resolved',
};

export const isInstallStage = (s: unknown): s is JobStatus => typeof s === 'string' && isJobStatus(s);
export const normaliseStage = (s: string): JobStatus => (isJobStatus(s) ? s : OLD[s] ?? 'received');
/** Where on the shown steps it is: In progress and the estimate sit on Working on site, Cancelled on New. */
const STRIP: Partial<Record<JobStatus, JobStatus>> = { in_progress: 'on_site', awaiting_estimate: 'on_site', cancelled: 'received' };
export const stageIndex = (s: string) => {
  const k = normaliseStage(s);
  return Math.max(0, INSTALL_STAGES.findIndex((x) => x.key === (STRIP[k] ?? k)));
};
export const stageLabel = (s: string) => officeLabel(normaliseStage(s));

/** Statuses in which the technician is on the job, so may ask for material. */
export const INSTALL_WORKING: readonly JobStatus[] = ['assigned', ...WORKING_STATUSES];
export const isInstallWorking = (s: string) => INSTALL_WORKING.includes(normaliseStage(s));

export interface StageFacts {
  /** The legacy challan status: pending | work_done | approved | rejected | legacy_unknown. */
  status: string;
  isInvoiced: boolean;
  notBilledReason: string | null;
  team: number;
  /** Installation visits not cancelled. */
  visits: number;
  /** A visit checked in at the site, or an item fitted. */
  onSite: boolean;
}

const RANK: Record<JobStatus, number> = {
  received: 0, assigned: 1, accepted: 2, scheduled: 3, on_the_way: 4, on_site: 5, in_progress: 5, awaiting_estimate: 5,
  awaiting_customer: 6, resolved: 7, closed: 8, cancelled: 9,
};

/**
 * Where what has happened puts the job, from where it is. Only forward -
 * the steps people take (Accept, the code, the office's picker) are never
 * undone by it - except: the team emptied puts "Waiting for technician" back
 * to New, and Sent back puts a finished job back to In progress. A job
 * waiting for its technician to Accept is not moved on by a visit booked
 * for him, as a complaint is not.
 */
export function autoStatus(current: string, f: StageFacts): JobStatus {
  const cur = normaliseStage(current);
  if (cur === 'cancelled') return cur;
  if (f.isInvoiced || f.notBilledReason) return 'closed';
  if (cur === 'closed') return cur;
  if (f.status === 'rejected' && RANK[cur] >= RANK.awaiting_customer) return 'in_progress';
  if (cur === 'assigned' && f.team === 0) return 'received';
  let floor: JobStatus = 'received';
  if (f.status === 'approved') floor = 'resolved';
  else if (f.status === 'work_done') floor = 'awaiting_customer';
  else if (f.onSite) floor = 'on_site';
  else if (f.visits > 0 && RANK[cur] >= RANK.accepted) floor = 'scheduled';
  else if (f.team > 0) floor = 'assigned';
  return RANK[floor] > RANK[cur] ? floor : cur;
}

/**
 * The challan's old `status` for a new job status - what the phone builds
 * before 1.0.35 and the Approvals desk still read.
 */
export function legacyStatus(stage: JobStatus, current: string): string {
  if (stage === 'closed' || stage === 'cancelled') return current;
  if (stage === 'awaiting_customer' || stage === 'resolved') return current === 'approved' ? current : 'work_done';
  return current === 'rejected' ? current : 'pending';
}

export interface MaterialRow {
  name: string;
  unit: string;
  issued: number;
  used: number;
  /** Extra beyond the quotation, to bill (paise). 0 when nothing to bill. */
  extraPaise: number;
}

/**
 * Which order lines are still free to put on a new installation. A line is
 * covered when any installation (not deleted) already fits it. Old challans
 * made before lines were linked cover their order's lines by product.
 */
export function freeOrderLines<L extends { id: string; productId: string | null; productName: string }>(
  lines: L[],
  challans: { items: { salesOrderItemId: string | null; productId: string | null; productName: string }[] }[],
): { free: L[]; covered: L[] } {
  const byLine = new Set<string>();
  const legacyKeys = new Set<string>();
  for (const c of challans) {
    for (const it of c.items) {
      if (it.salesOrderItemId) byLine.add(it.salesOrderItemId);
      else legacyKeys.add(it.productId ?? `name:${it.productName}`);
    }
  }
  const free: L[] = []; const covered: L[] = [];
  for (const l of lines) {
    if (byLine.has(l.id) || legacyKeys.has(l.productId ?? `name:${l.productName}`)) covered.push(l);
    else free.push(l);
  }
  return { free, covered };
}
