import 'server-only';
import { db } from './db';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import { DOC_TYPES, type DocType } from './document-number';
import { NUMBER_HOME, isStatutory } from './document-number-home';
import { getFinancialYear } from '@/lib/financial-year';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * "WHERE IS INVOICE 0008?" - the question this answers (3 Oct 2026).
 *
 * A document number is allocated before its document is written. If the write
 * fails, the number is gone and the series shows a gap. `allocateDocumentNumber`
 * now records every allocation and hands unclaimed numbers out again, so new
 * gaps are rare - but gaps created before 3 Oct 2026 have no allocation row at
 * all, and those can only be found by reading the documents themselves.
 *
 * So this report works from BOTH ends:
 *
 *   the ledger      numbers we know were issued, and whether anything claimed
 *                   them. Complete from 3 Oct 2026 onward.
 *   the documents   the numbers actually in use, which exposes gaps from before
 *                   the ledger existed.
 *
 * An auditor's question gets one of three answers, and all three are better than
 * the shrug that was available before: this number is in use; this number was
 * issued at 14:32 and the save failed; or this number is missing from a series
 * that predates our records, and here is the date range it sits in.
 */

export interface SeriesGap {
  sequence: number;
  number: string;
  /** Null for a gap found by reading documents - nothing recorded its issue. */
  allocatedAt: Date | null;
  allocatedByName: string | null;
  /** True when the number was handed out again and is now in use elsewhere. */
  reissued: boolean;
}

export interface SeriesRow {
  docType: DocType;
  label: string;
  financialYear: number;
  /** Statutory series must not show a gap - see document-number-home. */
  statutory: boolean;
  /** The highest number issued in this series this year. */
  lastSequence: number;
  /** How many documents actually hold a number from it. */
  inUse: number;
  gaps: SeriesGap[];
  /**
   * True when this series' numbers are not stored on any row, so nothing about
   * it can be reconciled. Said rather than hidden.
   */
  unreconcilable: boolean;
}

export interface DocumentNumberReport {
  financialYear: number;
  series: SeriesRow[];
  /** Gaps across every statutory series - the figure that matters. */
  statutoryGaps: number;
  totalGaps: number;
  /**
   * The date the allocation ledger started. Gaps before it cannot name who
   * issued the number, and the screen says so rather than showing a blank.
   */
  ledgerFrom: Date | null;
}

const LABEL: Partial<Record<DocType, string>> = {
  QT: 'Quotations', SO: 'Sales orders', INV: 'Invoices', PO: 'Purchase orders',
  GRN: 'Goods receipts', GDN: 'Goods dispatch', RCP: 'Receipts', SR: 'Sales returns',
  CN: 'Credit notes', RF: 'Refunds', PB: 'Purchase bills', PMT: 'Supplier payments',
  JE: 'Journal entries', ST: 'Staff transactions', TXN: 'Expenses and income',
  PR: 'Purchase returns', DN: 'Supplier debit notes', MO: 'Production orders',
  CMP: 'Complaints', RCH: 'Repair challans', ICH: 'Installation challans',
  JCH: 'Job challans', AMC: 'AMC contracts', RMA: 'Replacement cases',
  HD: 'Helpdesk tickets', POS: 'Point of sale',
};

export async function documentNumberReport(
  scope: StoreScope, financialYear = getFinancialYear(),
): Promise<DocumentNumberReport> {
  /**
   * Single-branch only, and it is not a limitation worth working around.
   *
   * A series belongs to one branch - the branch code is IN the number - so "All
   * Company" would interleave two independent sequences and report every number
   * of branch B as a gap in branch A's. An empty report is the honest answer.
   */
  if (scope.kind !== 'single') {
    return { financialYear, series: [], statutoryGaps: 0, totalGaps: 0, ledgerFrom: null };
  }

  const [sequences, allocations, oldest] = await Promise.all([
    db.documentSequence.findMany({
      where: { ...scopeWhere(scope), financialYear },
      select: { docType: true, lastSequence: true },
    }),
    db.documentNumberAllocation.findMany({
      where: { ...scopeWhere(scope), financialYear },
      orderBy: { sequence: 'asc' },
      take: LIST_MAX_ROWS,
      select: {
        docType: true, sequence: true, number: true,
        claimedAt: true, reissuedAt: true, allocatedAt: true, allocatedBy: true,
      },
    }),
    db.documentNumberAllocation.findFirst({
      where: scopeWhere(scope),
      orderBy: { allocatedAt: 'asc' },
      select: { allocatedAt: true },
    }),
  ]);

  const names = await resolveNames(scope, allocations.map((a) => a.allocatedBy));

  const series: SeriesRow[] = [];

  for (const seq of sequences.sort((a, b) => a.docType.localeCompare(b.docType))) {
    const docType = seq.docType as DocType;
    if (!DOC_TYPES.includes(docType)) continue;

    const home = NUMBER_HOME[docType];
    const mine = allocations.filter((a) => a.docType === docType);

    /**
     * The numbers documents actually hold, read from the document table.
     *
     * This is what finds gaps older than the ledger. Identifiers come from
     * `NUMBER_HOME`, a module constant with a test behind it, never from input.
     */
    const used = home
      ? await db.$queryRawUnsafe<{ n: string }[]>(
        `SELECT "${home.column}" AS n FROM "${home.table}" `
        + `WHERE "storeId" = $1 AND "${home.column}" LIKE $2`,
        scope.storeId,
        `${docType}-%-${financialYear}-%`,
      ).catch(() => null)
      : null;

    const usedSeq = new Set<number>();
    for (const r of used ?? []) {
      const n = Number(r.n.split('-').pop());
      if (Number.isFinite(n)) usedSeq.add(n);
    }

    const gaps: SeriesGap[] = [];
    if (used !== null) {
      for (let i = 1; i <= seq.lastSequence; i += 1) {
        if (usedSeq.has(i)) continue;
        const a = mine.find((x) => x.sequence === i);
        /**
         * A reissued number that is NOT in use is still a gap - the second
         * attempt failed too. A reissued number that IS in use was already
         * skipped above, so it never reaches here.
         */
        gaps.push({
          sequence: i,
          number: a?.number ?? `${docType}-?-${financialYear}-${String(i).padStart(4, '0')}`,
          allocatedAt: a?.allocatedAt ?? null,
          allocatedByName: a?.allocatedBy ? names.get(a.allocatedBy) ?? null : null,
          reissued: a?.reissuedAt != null,
        });
      }
    }

    series.push({
      docType,
      label: LABEL[docType] ?? docType,
      financialYear,
      statutory: isStatutory(docType),
      lastSequence: seq.lastSequence,
      inUse: usedSeq.size,
      gaps,
      unreconcilable: used === null,
    });
  }

  // Statutory first, then the biggest problem, then alphabetically. The top of
  // the page should be the thing that gets asked about.
  series.sort((a, b) => (
    Number(b.statutory) - Number(a.statutory)
    || b.gaps.length - a.gaps.length
    || a.label.localeCompare(b.label)
  ));

  return {
    financialYear,
    series,
    statutoryGaps: series.filter((s) => s.statutory).reduce((n, s) => n + s.gaps.length, 0),
    totalGaps: series.reduce((n, s) => n + s.gaps.length, 0),
    ledgerFrom: oldest?.allocatedAt ?? null,
  };
}

async function resolveNames(
  scope: StoreScope, ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  /**
   * Scoped twice over. The ids came off allocation rows this scope already read,
   * so they are themselves the scope - but `userInScope` is applied as well,
   * because the store-scope coverage test reads call sites literally and a query
   * on a per-store table whose filter is not visible AT the query is exactly
   * what that test exists to stop. A filter a test cannot see is a filter the
   * next person can delete.
   */
  const users = await db.user.findMany({
    where: { id: { in: unique }, ...userInScope(scope) },
    select: { id: true, fullName: true },
  }).catch(() => []);
  return new Map(users.map((u) => [u.id, u.fullName]));
}
