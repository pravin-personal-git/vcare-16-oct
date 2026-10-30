import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { monthlySummary } from '../attendance-reports';
import type { StoreScope } from '../store-scope';
import type { MetricValue } from '@/lib/scorecard/score';
import { monthsIn } from '@/lib/scorecard/period';

/** One thing behind a number - a job, an edit, an approval - opened from the scorecard. */
export interface Evidence {
  metric: string;
  /** Set on a counted miss: what a manager clears it by. */
  ruleKey: string | null;
  refId: string;
  refNo: string;
  href: string;
  at: Date;
  text: string;
  /** How much it counts: a mistake 2, an SOP miss 1, a fact 0. */
  weight: number;
}

export type Values = Map<string, Map<string, MetricValue>>;
export interface EngineOut { values: Values; evidence: Map<string, Evidence[]> }

export function newOut(): EngineOut { return { values: new Map(), evidence: new Map() }; }

export function setVal(out: EngineOut, key: string, userId: string, value: number | null, n: number) {
  const m = out.values.get(key) ?? new Map<string, MetricValue>();
  m.set(userId, { value: value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10, n });
  out.values.set(key, m);
}

export function addEvidence(out: EngineOut, userId: string | null | undefined, e: Evidence) {
  if (!userId) return;
  const list = out.evidence.get(userId) ?? [];
  list.push(e);
  out.evidence.set(userId, list);
}

export const clearKey = (userId: string, ruleKey: string, refId: string) => `${userId}|${ruleKey}|${refId}`;

/** Share as 0-100, null when nothing to share. */
export const pct = (hit: number, of: number) => (of > 0 ? (hit / of) * 100 : null);

/** Map of key -> rows. */
export function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
}

/** Who held the job when: every change of `assignedTechnicianId` from the audit trail, oldest first. */
export async function assignmentHistory(ids: string[]): Promise<Map<string, { at: number; from: string | null; to: string | null }[]>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{ rowId: string; createdAt: Date; v: unknown }[]>(Prisma.sql`
    SELECT "rowId", "createdAt", changed->'assignedTechnicianId' AS v
    FROM "AuditEvent"
    WHERE "tableName" = 'Complaint' AND action = 'update' AND "rowId" = ANY(${ids})
      AND jsonb_exists(changed, 'assignedTechnicianId')
    ORDER BY "createdAt" ASC`);
  const out = new Map<string, { at: number; from: string | null; to: string | null }[]>();
  for (const r of rows) {
    const v = Array.isArray(r.v) ? r.v : null;
    if (!v) continue;
    const list = out.get(r.rowId) ?? [];
    list.push({ at: r.createdAt.getTime(), from: typeof v[0] === 'string' ? v[0] : null, to: typeof v[1] === 'string' ? v[1] : null });
    out.set(r.rowId, list);
  }
  return out;
}

/** Complaints whose technician changed inside the window. */
export async function complaintsReassignedIn(storeIds: string[], from: Date, to: Date): Promise<string[]> {
  if (!storeIds.length) return [];
  const rows = await db.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT "rowId" FROM "AuditEvent"
    WHERE "tableName" = 'Complaint' AND action = 'update' AND "storeId" = ANY(${storeIds})
      AND "createdAt" >= ${from} AND "createdAt" < ${to}
      AND jsonb_exists(changed, 'assignedTechnicianId')`);
  return rows.map((r) => r.rowId).filter(Boolean);
}

/** Attendance for every month the period touches: present share and late arrivals per 20 working days. */
export async function reliability(scope: StoreScope, userIds: string[], from: Date, to: Date, out: EngineOut) {
  const only = new Set(userIds);
  const tally = new Map<string, { present: number; late: number; working: number }>();
  for (const [y, m] of monthsIn(from, to)) {
    const rows = await monthlySummary(scope, y, m, only).catch(() => []);
    for (const r of rows) {
      const t = tally.get(r.userId) ?? { present: 0, late: 0, working: 0 };
      t.present += r.present + r.late + r.halfDay * 0.5 + r.wfh;
      t.late += r.late;
      t.working += r.workingDays;
      tally.set(r.userId, t);
    }
  }
  for (const id of userIds) {
    const t = tally.get(id);
    setVal(out, 'r_present', id, t && t.working ? Math.min(100, (t.present / t.working) * 100) : null, t?.working ?? 0);
    setVal(out, 'r_late', id, t && t.working ? (t.late / t.working) * 20 : null, t?.working ?? 0);
  }
}
