import type { JobSettingsValue } from './job-settings';

/**
 * Job deadlines (workflow slice 7, spec §4.9, Pravin round 3): per priority,
 * accept within / reach the site within / close within. Near a deadline
 * (80% of the time used) the technician is reminded; past it the office is
 * alerted and the job shows red.
 *
 * The clock does not run against us while the job waits on the customer
 * (estimate or confirmation) - those states are not checked.
 *
 * Only jobs raised in Atlas itself are tracked - never migrated ones (they
 * carry a legacyRef; the weekly Vcare top-ups import old jobs with recent
 * dates) - and none from before the engine was built. Otherwise thousands of
 * old jobs would all be "overdue" at once.
 */
export const SLA_START = new Date('2026-09-27T00:00:00+05:30');

export type SlaKind = 'accept' | 'visit' | 'close';
export type SlaState = 'ok' | 'near' | 'missed';
export interface SlaCheck { kind: SlaKind; due: Date; state: SlaState }

const WAITING_ON_CUSTOMER = ['awaiting_estimate', 'awaiting_customer'];
const FINISHED = ['resolved', 'closed', 'cancelled'];
const H = 3_600_000;

export function slaChecks(job: {
  status: string; priority: string; createdAt: Date; assignedAt: Date | null;
  /** Has the technician reached the site at least once. */
  arrived: boolean;
  /** Imported from another system (legacyRef set) - never tracked. */
  migrated?: boolean;
}, sla: JobSettingsValue['sla'], now: Date = new Date()): SlaCheck[] {
  if (job.migrated || job.createdAt < SLA_START) return [];
  if (FINISHED.includes(job.status) || WAITING_ON_CUSTOMER.includes(job.status)) return [];
  const p = (sla as Record<string, JobSettingsValue['sla']['normal']>)[job.priority] ?? sla.normal;
  const out: SlaCheck[] = [];
  const check = (kind: SlaKind, from: Date, hours: number) => {
    const due = new Date(from.getTime() + hours * H);
    const used = (now.getTime() - from.getTime()) / (hours * H);
    out.push({ kind, due, state: used >= 1 ? 'missed' : used >= 0.8 ? 'near' : 'ok' });
  };
  if (job.status === 'assigned' && job.assignedAt) check('accept', job.assignedAt, p.accept);
  if (!job.arrived) check('visit', job.createdAt, p.visit);
  check('close', job.createdAt, p.close);
  return out;
}

/** The worst state across a job's deadlines - for a red / amber mark on lists. */
export function slaWorst(checks: SlaCheck[]): SlaState {
  return checks.some((c) => c.state === 'missed') ? 'missed' : checks.some((c) => c.state === 'near') ? 'near' : 'ok';
}

export const SLA_LABEL: Record<SlaKind, string> = { accept: 'accept', visit: 'reach the site', close: 'close' };
