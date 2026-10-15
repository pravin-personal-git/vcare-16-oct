import 'server-only';
import { db } from './db';
import { formatDocumentNumber, type DocType } from './document-number';
import { NUMBER_HOME } from './document-number-home';
import { getFinancialYear } from '@/lib/financial-year';

/**
 * Allocates the next document number for a store and financial year.
 *
 * ## Concurrency
 *
 * A single upsert with an atomic `increment`, so two simultaneous callers cannot
 * receive the same sequence. Reading then writing separately would eventually
 * produce duplicate invoice numbers, which is the kind of bug you discover
 * during an audit.
 *
 * The old shape had a race on exactly one document a year: the first of a new
 * financial year. Two callers both found no row, both tried to create it, and one
 * died on the unique constraint. Rare, but 1 April is precisely when a shop is
 * busy and least able to deal with an invoice that will not save. The upsert
 * pushes that decision into Postgres, which resolves it against the unique
 * index.
 *
 * ## BURNT NUMBERS - fixed 3 Oct 2026
 *
 * The number is allocated here and the document is written afterwards. If that
 * write fails - a locked period, an unknown account code, a dropped connection -
 * the number was simply gone: INV-0007 then INV-0009, with nothing anywhere
 * recording that 0008 had ever existed. GST expects an unbroken series and an
 * auditor who finds a gap asks what was in it.
 *
 * Both halves of the fix are here, and neither needs anything to change at the
 * thirty call sites:
 *
 *   1. EVERY allocation is recorded (`DocumentNumberAllocation`). A gap can be
 *      explained - who issued it, when, and that nothing ever claimed it.
 *   2. An unclaimed number is HANDED OUT AGAIN before a fresh one is taken, so
 *      the ordinary case leaves no gap to explain.
 *
 * Reuse is deliberately cautious, because handing out a number a document
 * already holds would be far worse than a gap:
 *
 *   - only allocations older than `REUSE_AFTER_MS` are considered, so a save
 *     still in flight is never stolen from;
 *   - the document table is checked directly for each candidate, and anything
 *     found is marked claimed rather than reused;
 *   - a series whose numbers are not stored on any row (`NUMBER_HOME` null) is
 *     never reused at all, because "not found" cannot be distinguished from
 *     "not recorded";
 *   - the document tables' own unique constraints remain the backstop. If this
 *     logic is ever wrong, the database refuses the insert instead of letting
 *     two documents share a number.
 *
 * Spec: 03-technical-docs/01-specification/04-quotation.md §5.1
 */

/**
 * How long a number must have gone unclaimed before it may be reissued.
 *
 * Two minutes. A document save takes well under a second, so anything still
 * unclaimed after two minutes failed - but the window has to be comfortably
 * longer than the slowest plausible save, because reissuing a number whose
 * document is about to appear would collide. Two minutes is roughly a hundred
 * times the worst observed save and still short enough that a busy counter
 * reclaims the number within the same session.
 */
const REUSE_AFTER_MS = 2 * 60_000;

/** At most this many burnt candidates are examined per call. */
const CANDIDATE_LIMIT = 20;

export async function allocateDocumentNumber(
  storeId: string,
  docType: DocType,
  at: Date = new Date(),
  allocatedBy: string | null = null,
): Promise<string> {
  const financialYear = getFinancialYear(at);

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { branchCode: true },
  });

  const reused = await reissueBurntNumber(storeId, docType, financialYear);
  if (reused) return reused;

  const seq = await db.documentSequence.upsert({
    where: { storeId_docType_financialYear: { storeId, docType, financialYear } },
    create: { storeId, docType, financialYear, lastSequence: 1 },
    update: { lastSequence: { increment: 1 } },
  });

  const number = formatDocumentNumber({
    docType,
    branchCode: store.branchCode,
    financialYear,
    sequence: seq.lastSequence,
    padding: seq.padding,
  });

  /**
   * Recorded, and a failure here does NOT fail the allocation.
   *
   * The ledger exists to explain gaps; it must never become a reason a shop
   * cannot raise an invoice. A missing allocation row makes one number
   * unexplainable, which is the situation every number was in before this
   * existed - strictly no worse, and not worth a blocked sale.
   */
  await db.documentNumberAllocation.create({
    data: { storeId, docType, financialYear, sequence: seq.lastSequence, number, allocatedBy },
  }).catch((e) => {
    console.error('[document-number] allocation ledger write failed (non-fatal)', e);
  });

  return number;
}

/**
 * Hand back a number that was issued and never used, if there is one.
 *
 * Returns null in every uncertain case. The whole function is an optimisation
 * over "take a fresh number", and a wrong answer here is a duplicate document
 * number - so every branch that cannot be sure returns null.
 */
async function reissueBurntNumber(
  storeId: string, docType: DocType, financialYear: number,
): Promise<string | null> {
  const home = NUMBER_HOME[docType];
  // Not stored anywhere, so "no document holds it" is unknowable.
  if (!home) return null;

  const candidates = await db.documentNumberAllocation.findMany({
    where: {
      storeId, docType, financialYear,
      claimedAt: null,
      reissuedAt: null,
      allocatedAt: { lt: new Date(Date.now() - REUSE_AFTER_MS) },
    },
    // Oldest first: the earliest gap is the one an auditor reads down to.
    orderBy: { sequence: 'asc' },
    take: CANDIDATE_LIMIT,
    select: { id: true, number: true },
  }).catch(() => []);

  if (candidates.length === 0) return null;

  /**
   * Which of those numbers a document actually holds.
   *
   * Raw SQL because the table and column vary by series. The identifiers come
   * from `NUMBER_HOME`, a module constant checked by a test against
   * schema.prisma - never from a caller - and the values are parameterised, so
   * there is nothing here an input can reach.
   */
  const found = await db.$queryRawUnsafe<{ n: string }[]>(
    `SELECT "${home.column}" AS n FROM "${home.table}" `
    + 'WHERE "storeId" = $1 AND "' + home.column + '" = ANY($2::text[])',
    storeId,
    candidates.map((c) => c.number),
  ).catch(() => null);

  // A failed lookup means we do not know. Take a fresh number.
  if (found === null) return null;

  const taken = new Set(found.map((r) => r.n));

  // Mark the ones that WERE claimed, so they are never examined again. This is
  // how the ledger self-corrects: a slow save that finished after the window
  // is recorded as claimed rather than treated as burnt forever.
  const claimed = candidates.filter((c) => taken.has(c.number));
  if (claimed.length > 0) {
    await db.documentNumberAllocation.updateMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      data: { claimedAt: new Date() },
    }).catch(() => undefined);
  }

  const free = candidates.find((c) => !taken.has(c.number));
  if (!free) return null;

  /**
   * Claim it before returning it.
   *
   * `updateMany` with `reissuedAt: null` in the filter makes this a compare-and-
   * set: two callers racing for the same burnt number, one wins and the other
   * sees `count === 0` and falls through to a fresh number. Without it both
   * would be handed the same one.
   */
  const won = await db.documentNumberAllocation.updateMany({
    where: { id: free.id, reissuedAt: null, claimedAt: null },
    data: { reissuedAt: new Date() },
  }).catch(() => ({ count: 0 }));
  if (won.count === 0) return null;

  /**
   * The original row carries the whole story - issued at X, nothing claimed it,
   * reissued at Y - so there is no second row to write. `reissuedAt` also takes
   * it out of the candidate set permanently, which means a number whose SECOND
   * attempt also fails stays burnt rather than being offered a third time. That
   * is the conservative direction, and the right one: one unexplained gap is a
   * footnote, a duplicated invoice number is a legal problem.
   */
  return free.number;
}
