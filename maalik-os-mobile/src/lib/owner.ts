import { authed } from './api';
import { send } from './outbox';

/** The owner's home on the phone (13 Oct 2026, decision 11 B) - server/owner-phone on the website. */
export interface OwnerSummary {
  today: string;
  salesPaise: number; invoiceCount: number;
  collectedPaise: number; receiptCount: number;
  toCollectPaise: number; overduePaise: number;
  jobs: { open: number; late: number; unassigned: number };
  unassigned: { id: string; complaintNo: string; description: string; priority: string; createdAt: string; siteLocation: string | null; customerName: string }[];
  approvalsWaiting: number;
  remindersToday: number;
  /** Shop requests nobody has picked up (servers from 13 Oct 2026). */
  shopRequestsNew?: number;
  technicians: { id: string; name: string }[];
}

export const ownerSummary = () => authed<OwnerSummary>('/api/v1/owner/summary');

/** Assign a complaint (one technician) or set an installation's team - through the outbox, so it works offline. */
export const assignJob = (kind: 'complaint' | 'installation', id: string, technicianIds: string[]) =>
  send<{ ok: true; message: string }>('/api/v1/owner/assign', { kind, id, technicianIds }, { label: kind === 'installation' ? 'Installation team set' : 'Job assigned', target: `${kind}:${id}` });

// ------------------------------------------------- the office job board (native admin app, 13 Oct 2026)

export type OfficeGroup = 'unassigned' | 'todo' | 'working' | 'waiting';
export interface OfficeJob {
  kind: 'complaint' | 'installation'; id: string; no: string; customerName: string; siteLocation: string | null;
  problem: string; status: string; statusLabel: string; priority: string; givenAt: string; createdAt: string;
  nextVisitAt: string | null; late: boolean; lateReason: string | null; today: boolean;
  group: OfficeGroup; technicianIds: string[]; technicianNames: string[];
}
export const officeJobs = () =>
  authed<{ jobs: OfficeJob[]; technicians: { id: string; name: string }[]; now: string; canAssign: boolean }>('/api/v1/office/jobs');
