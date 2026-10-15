import 'server-only';
import { db } from './db';
import { contextRefs, ownText, refKey, refKind, type RefKind } from '@/lib/audit-references';

/**
 * The lookups behind `lib/audit-references.ts` (Stage G, 3 Oct 2026): one
 * query per KIND of thing on a page of events, never one per event.
 *
 * Every lookup says `deletedAt: undefined`. That is the documented escape hatch
 * in `server/soft-delete.ts`: a log must still name the technician who left in
 * August and the product that was retired, or the history it exists to keep
 * turns into ids at exactly the moment somebody needs it.
 */

type Names = Map<string, string>;

const party = (p: { companyName: string | null; firstName: string; lastName: string | null }) =>
  p.companyName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(' ');

async function lookup(kind: RefKind, ids: string[]): Promise<[string, string][]> {
  const where = { id: { in: ids }, deletedAt: undefined };
  switch (kind) {
    case 'user':
      return (await db.user.findMany({ where, select: { id: true, fullName: true } })).map((r) => [r.id, r.fullName]);
    case 'party':
      return (await db.party.findMany({ where, select: { id: true, companyName: true, firstName: true, lastName: true } }))
        .map((r) => [r.id, party(r)]);
    case 'product':
      return (await db.product.findMany({ where, select: { id: true, productName: true } })).map((r) => [r.id, r.productName]);
    case 'lead':
      return (await db.lead.findMany({ where, select: { id: true, leadCode: true, firstName: true, lastName: true } }))
        .map((r) => [r.id, `${r.leadCode} ${[r.firstName, r.lastName].filter(Boolean).join(' ')}`.trim()]);
    case 'role':
      return (await db.role.findMany({ where, select: { id: true, name: true } })).map((r) => [r.id, r.name]);
    case 'menu':
      return (await db.menu.findMany({ where, select: { id: true, label: true } })).map((r) => [r.id, r.label]);
    case 'permission':
      return (await db.permission.findMany({ where, select: { id: true, key: true } })).map((r) => [r.id, r.key]);
    case 'account':
      return (await db.account.findMany({ where, select: { id: true, name: true } })).map((r) => [r.id, r.name]);
    case 'complaint':
      return (await db.complaint.findMany({ where, select: { id: true, complaintNo: true } })).map((r) => [r.id, r.complaintNo]);
    case 'installationChallan':
      return (await db.installationChallan.findMany({ where, select: { id: true, challanNo: true } })).map((r) => [r.id, r.challanNo]);
    case 'jobChallan':
      return (await db.jobChallan.findMany({ where, select: { id: true, challanNo: true } })).map((r) => [r.id, r.challanNo]);
    case 'journalEntry':
      return (await db.journalEntry.findMany({ where, select: { id: true, entryNo: true } })).map((r) => [r.id, r.entryNo]);
    case 'notification':
      return (await db.notification.findMany({ where, select: { id: true, title: true } })).map((r) => [r.id, r.title]);
    case 'warehouse':
      return (await db.warehouse.findMany({ where, select: { id: true, name: true } })).map((r) => [r.id, r.name]);
    case 'leaveType':
      return (await db.leaveType.findMany({ where, select: { id: true, name: true } })).map((r) => [r.id, r.name]);
    case 'listing':
      return (await db.catalogueListing.findMany({
        where, select: { id: true, headline: true, product: { select: { productName: true } } },
      })).map((r) => [r.id, r.headline?.trim() || r.product.productName]);
  }
}

/**
 * Resolve every id the page will show, in one batch per kind.
 *
 * A failed lookup is swallowed on purpose: this is a report, and an id shown
 * where a name could not be found is a smaller harm than a log that will not
 * open because one table could not be read.
 */
async function resolve(wanted: Map<RefKind, Set<string>>): Promise<Names> {
  const names: Names = new Map();
  await Promise.all([...wanted].map(async ([kind, ids]) => {
    try {
      for (const [id, name] of await lookup(kind, [...ids])) if (name) names.set(refKey(kind, id), name);
    } catch { /* see above */ }
  }));
  return names;
}

/** Prisma delegate name for a table: "InstallationChallanItem" -> "installationChallanItem". */
const delegate = (table: string) => table.charAt(0).toLowerCase() + table.slice(1);

/**
 * The current row for each UPDATE event with no label of its own. An update
 * records only what changed, so the lead a note belongs to is not in it - the
 * row is read instead. Inserts and deletes carry the whole row already.
 */
async function currentRows(events: { tableName: string; rowId: string | null }[]): Promise<Map<string, Record<string, unknown>>> {
  const byTable = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.rowId) continue;
    if (!byTable.has(e.tableName)) byTable.set(e.tableName, new Set());
    byTable.get(e.tableName)!.add(e.rowId);
  }
  const rows = new Map<string, Record<string, unknown>>();
  await Promise.all([...byTable].map(async ([table, ids]) => {
    // Dynamic by design: the log spans 208 tables and a typed switch over all
    // of them would be the thing that went stale. A table with no plain `id`
    // throws here, and that event simply keeps its old description.
    const model = (db as unknown as Record<string, { findMany?: (a: unknown) => Promise<Record<string, unknown>[]> }>)[delegate(table)];
    if (!model?.findMany) return;
    try {
      for (const r of await model.findMany({ where: { id: { in: [...ids] }, deletedAt: undefined } })) {
        rows.set(`${table}:${String(r.id)}`, r);
      }
    } catch { /* see above */ }
  }));
  return rows;
}

export interface EventForDescription {
  tableName: string;
  rowId: string | null;
  label: string | null;
  action: string;
  changed: Record<string, unknown>;
}

export interface Describer {
  /** What an unlabelled event is about, e.g. "LEAD-212 Sharma Traders". */
  context: (e: EventForDescription) => string | null;
  /** The name behind an id field, for the Details table. */
  nameOf: (table: string) => (field: string, value: unknown) => string | undefined;
}

/** Build the names for one page of events. */
export async function describerFor(events: EventForDescription[]): Promise<Describer> {
  const unlabelled = events.filter((e) => !e.label);
  const rows = await currentRows(unlabelled.filter((e) => e.action === 'update'));
  const rowOf = (e: EventForDescription) =>
    e.action === 'update' ? rows.get(`${e.tableName}:${e.rowId}`) ?? null : e.changed;

  const wanted = new Map<RefKind, Set<string>>();
  const want = (kind: RefKind, id: string) => {
    if (!wanted.has(kind)) wanted.set(kind, new Set());
    wanted.get(kind)!.add(id);
  };
  for (const e of unlabelled) for (const r of contextRefs(e.tableName, rowOf(e))) want(r.kind, r.id);
  for (const e of events) {
    for (const [field, v] of Object.entries(e.changed)) {
      const kind = refKind(e.tableName, field);
      if (!kind) continue;
      // An update stores [before, after]; an insert or delete the value alone.
      for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string' && id) want(kind, id);
    }
  }
  const names = await resolve(wanted);

  return {
    context: (e) => {
      if (e.label) return null;
      const row = rowOf(e);
      const parts = contextRefs(e.tableName, row)
        .map((r) => names.get(refKey(r.kind, r.id)))
        .filter((s): s is string => !!s);
      const own = ownText(row);
      if (own) parts.push(own);
      return parts.length ? parts.join(' · ') : null;
    },
    nameOf: (table) => (field, value) => {
      const kind = refKind(table, field);
      return kind && typeof value === 'string' ? names.get(refKey(kind, value)) : undefined;
    },
  };
}
