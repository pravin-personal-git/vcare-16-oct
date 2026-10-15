import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import type { StoreScope } from './store-scope';
import { describeChange, tableLabel, type FieldChange } from '@/lib/audit-format';
import { AUDIT_AREAS, PLACED_TABLES, areaOf, tablesInArea, type AuditArea } from '@/lib/audit-areas';
import { describerFor } from './audit-describe';

/**
 * Reading the audit trail (health check AUD-1): every create, change and
 * delete recorded by the database trigger, plus the sign-in / sign-out /
 * failed-password events from ActivityLog. Always paged and filtered on the
 * server - the table grows with every save, so nothing here loads it whole.
 */

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  /** Money, stock, sales, people, settings - or 'other' for a table no area claims yet. */
  area?: AuditArea | 'other' | null;
  person?: string | null;
  table?: string | null;
  action?: string | null;
  row?: string | null;
  q?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface AuditRow {
  id: string;
  at: string;
  table: string;
  tableLabel: string;
  rowId: string | null;
  label: string | null;
  /**
   * What an event with no name of its own is about, looked up when the page
   * is read ("LEAD-212 Sharma Traders"). Null when the event has a label.
   */
  context: string | null;
  area: AuditArea | null;
  action: string;
  actor: string;
  actorId: string | null;
  via: string | null;
  ip: string | null;
  summary: string;
  changes: FieldChange[];
}

export interface EventRow {
  id: string;
  at: string;
  type: string;
  description: string;
  actor: string;
  ip: string | null;
}

function storeFilter(scope: StoreScope, storeIds: string[]): Prisma.AuditEventWhereInput {
  return scope.kind === 'single' ? { storeId: scope.storeId } : { storeId: { in: storeIds } };
}

function areaFilter(area: AuditFilters['area']): Prisma.AuditEventWhereInput {
  if (!area) return {};
  if (area === 'other') return { tableName: { notIn: [...PLACED_TABLES] } };
  return { tableName: { in: [...tablesInArea(area)] } };
}

function where(scope: StoreScope, storeIds: string[], f: AuditFilters): Prisma.AuditEventWhereInput {
  return {
    ...storeFilter(scope, storeIds),
    ...areaFilter(f.area),
    ...(f.person ? { actorId: f.person } : {}),
    ...(f.table ? { tableName: f.table } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.row ? { rowId: f.row } : {}),
    ...(f.q ? { OR: [{ label: { contains: f.q, mode: 'insensitive' } }, { rowId: f.q }] } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const [users, parties] = await Promise.all([
    db.user.findMany({ where: { id: { in: clean } }, select: { id: true, fullName: true } }),
    db.party.findMany({ where: { id: { in: clean } }, select: { id: true, companyName: true, firstName: true } }),
  ]);
  return new Map([
    ...users.map((u) => [u.id, u.fullName] as const),
    ...parties.map((p) => [p.id, `${p.companyName || p.firstName} (customer)`] as const),
  ]);
}

export async function listAuditEvents(
  scope: StoreScope, storeIds: string[], f: AuditFilters, page: number, pageSize = AUDIT_PAGE_SIZE,
): Promise<{ rows: AuditRow[]; total: number }> {
  const w = where(scope, storeIds, f);
  const [total, events] = await db.$transaction([
    db.auditEvent.count({ where: w }),
    db.auditEvent.findMany({ where: w, orderBy: { id: 'desc' }, skip: page * pageSize, take: pageSize }),
  ]);
  const [names, describer] = await Promise.all([
    actorNames(events.map((e) => e.actorId ?? '')),
    describerFor(events.map((e) => ({
      tableName: e.tableName, rowId: e.rowId, label: e.label, action: e.action,
      changed: (e.changed ?? {}) as Record<string, unknown>,
    }))),
  ]);
  return {
    total,
    rows: events.map((e) => {
      const changed = (e.changed ?? {}) as Record<string, unknown>;
      const d = describeChange(e.tableName, e.action, changed, describer.nameOf(e.tableName));
      return {
        id: String(e.id),
        at: e.createdAt.toISOString(),
        table: e.tableName,
        tableLabel: tableLabel(e.tableName),
        rowId: e.rowId,
        label: e.label,
        context: describer.context({ tableName: e.tableName, rowId: e.rowId, label: e.label, action: e.action, changed }),
        area: areaOf(e.tableName),
        action: e.action,
        actor: e.actorId ? names.get(e.actorId) ?? e.actorName ?? 'Unknown' : 'System',
        actorId: e.actorId,
        via: e.via,
        ip: e.ip,
        summary: d.summary,
        changes: d.changes,
      };
    }),
  };
}

export async function listSignInEvents(
  scope: StoreScope, storeIds: string[], f: AuditFilters, page: number, pageSize = AUDIT_PAGE_SIZE,
): Promise<{ rows: EventRow[]; total: number }> {
  const w: Prisma.ActivityLogWhereInput = {
    ...(scope.kind === 'single' ? { storeId: scope.storeId } : { storeId: { in: storeIds } }),
    ...(f.person ? { userId: f.person } : {}),
    ...(f.q ? { description: { contains: f.q, mode: 'insensitive' } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
  const [total, rows] = await db.$transaction([
    db.activityLog.count({ where: w }),
    db.activityLog.findMany({
      where: w, orderBy: { createdAt: 'desc' }, skip: page * pageSize, take: pageSize,
      include: { user: { select: { fullName: true } } },
    }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id, at: r.createdAt.toISOString(), type: r.activityType, description: r.description,
      actor: r.user?.fullName ?? 'System', ip: r.ipAddress,
    })),
  };
}

/** The tables that have events in scope, for the Module filter. */
export async function auditTables(scope: StoreScope, storeIds: string[]): Promise<{ value: string; label: string }[]> {
  const rows = await db.auditEvent.groupBy({ by: ['tableName'], where: storeFilter(scope, storeIds), orderBy: { tableName: 'asc' } });
  return rows.map((r) => ({ value: r.tableName, label: tableLabel(r.tableName) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** People who appear in the log, for the Person filter. */
export async function auditPeople(scope: StoreScope, storeIds: string[]): Promise<{ value: string; label: string }[]> {
  const rows = await db.auditEvent.groupBy({
    by: ['actorId'], where: { ...storeFilter(scope, storeIds), actorId: { not: null } }, orderBy: { actorId: 'asc' },
  });
  const names = await actorNames(rows.map((r) => r.actorId ?? ''));
  return rows.map((r) => ({ value: r.actorId!, label: names.get(r.actorId!) ?? r.actorId! })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * How many events each area holds in scope, for the counts on the area chips.
 * Reuses one groupBy over table names rather than five counts - the log is the
 * biggest table in the product and grows with every save.
 */
export async function auditAreaCounts(
  scope: StoreScope, storeIds: string[],
): Promise<Record<AuditArea | 'other', number>> {
  const rows = await db.auditEvent.groupBy({
    by: ['tableName'], where: storeFilter(scope, storeIds), _count: { _all: true }, orderBy: { tableName: 'asc' },
  });
  const out = Object.fromEntries([...AUDIT_AREAS, 'other'].map((a) => [a, 0])) as Record<AuditArea | 'other', number>;
  for (const r of rows) out[areaOf(r.tableName) ?? 'other'] += r._count._all;
  return out;
}
