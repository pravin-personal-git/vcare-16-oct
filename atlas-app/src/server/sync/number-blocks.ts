import 'server-only';
import { db } from '../db';
import type { DocType } from '../document-number';

/**
 * DOCUMENT NUMBERS THAT SURVIVE BEING OFFLINE (F2, spec §4.3, decision D10).
 *
 * `document-number.ts` issues numbers by incrementing `DocumentSequence`
 * inside a transaction. That is correct against one database and wrong against
 * two: a node in Bhilai and a node in Raipur, both offline, both increment
 * their own copy and both issue INV-BR001-2026-0042. A GST series has to be
 * sequential and unbroken, so this is not a conflict to reconcile afterwards -
 * it is a tax problem that cannot be fixed without renumbering, and
 * renumbering is the one thing you may never do.
 *
 * The fix is to move the moment of allocation earlier. The hub advances the
 * sequence by a whole block while the node is online and hands over the range;
 * the node then issues from its own range with no coordination at all. Two
 * nodes cannot collide because the hub never hands the same range out twice.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO.
 *
 * It never falls back to `DocumentSequence` when a block runs out. A fallback
 * would be a silent return to the colliding behaviour precisely when the node
 * is least able to detect it - offline. Running out is a refusal with a
 * sentence somebody can act on.
 */

export class NumberBlockError extends Error {}

/**
 * Default block size. Fifty invoices is roughly a week for a branch of Vcare's
 * size and months for the rarer series, which is the balance wanted: long
 * enough that an ordinary outage never touches it, short enough that the gap
 * register at year end is small.
 */
export const DEFAULT_BLOCK_SIZE = 50;

/** Top up at 30% remaining, so a node is refilled long before it is stuck. */
export const LOW_WATER_FRACTION = 0.3;

export interface BlockStatus {
  docType: string;
  financialYear: number;
  fromSeq: number;
  toSeq: number;
  nextSeq: number;
  remaining: number;
  /** Below the low-water mark - worth fetching more. */
  low: boolean;
  exhausted: boolean;
}

const remainingOf = (b: { toSeq: number; nextSeq: number }) => Math.max(0, b.toSeq - b.nextSeq + 1);

/**
 * Issue the next number from this node's block.
 *
 * Concurrency is handled by a conditional UPDATE rather than a read-then-write:
 * `nextSeq` is advanced only if it still holds the value we read, so two
 * simultaneous callers cannot both take the same number - one of them updates
 * zero rows and retries. Same shape as the party-code retry added on 29 Sep,
 * and for the same reason: a read-then-write under load is a duplicate waiting
 * to happen.
 */
export async function issueFromBlock(
  storeId: string, docType: DocType, financialYear: number, nodeId: string | null,
): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const block = await db.numberBlock.findFirst({
      where: { storeId, docType, financialYear, nodeId, exhaustedAt: null },
      orderBy: { fromSeq: 'asc' },
      select: { id: true, nextSeq: true, toSeq: true },
    });

    if (!block || block.nextSeq > block.toSeq) {
      if (block) {
        await db.numberBlock.updateMany({
          where: { id: block.id, exhaustedAt: null },
          data: { exhaustedAt: new Date() },
        });
        continue; // there may be another block behind this one
      }
      throw new NumberBlockError(
        `This branch has run out of ${docType} numbers. Connect to the internet once and they will top up automatically.`,
      );
    }

    const taken = block.nextSeq;
    const moved = await db.numberBlock.updateMany({
      // The `nextSeq` guard is the lock: only the caller that read this value
      // gets to advance it.
      where: { id: block.id, nextSeq: taken },
      data: {
        nextSeq: taken + 1,
        ...(taken === block.toSeq ? { exhaustedAt: new Date() } : {}),
      },
    });

    if (moved.count === 1) return taken;
    // Somebody else took it; read again.
  }

  throw new NumberBlockError('Could not get a document number just now. Try again.');
}

/**
 * Hand a node a fresh block. **Hub only** - this is the one place
 * `DocumentSequence` advances for a blocked series.
 *
 * Runs in a transaction so the sequence cannot advance without a block being
 * written against it: a crash between the two would burn a range nobody owns,
 * and those numbers could never be explained at year end.
 */
export async function allocateBlock(
  storeId: string, docType: DocType, financialYear: number, nodeId: string | null,
  size: number = DEFAULT_BLOCK_SIZE,
): Promise<{ fromSeq: number; toSeq: number }> {
  if (!Number.isInteger(size) || size < 1 || size > 10_000) {
    throw new NumberBlockError('That block size is not sensible.');
  }

  return db.$transaction(async (tx) => {
    const seq = await tx.documentSequence.upsert({
      where: { storeId_docType_financialYear: { storeId, docType, financialYear } },
      create: { storeId, docType, financialYear, lastSequence: size },
      update: { lastSequence: { increment: size } },
      select: { lastSequence: true },
    });

    const toSeq = seq.lastSequence;
    const fromSeq = toSeq - size + 1;

    await tx.numberBlock.create({
      data: { storeId, docType, financialYear, fromSeq, toSeq, nextSeq: fromSeq, nodeId },
    });

    return { fromSeq, toSeq };
  });
}

/** What this node holds, for Settings › Document numbers. */
export async function blockStatus(
  storeId: string, nodeId: string | null,
): Promise<BlockStatus[]> {
  const rows = await db.numberBlock.findMany({
    where: { storeId, nodeId, exhaustedAt: null },
    orderBy: [{ docType: 'asc' }, { fromSeq: 'asc' }],
    select: { docType: true, financialYear: true, fromSeq: true, toSeq: true, nextSeq: true },
  });

  return rows.map((b) => {
    const remaining = remainingOf(b);
    return {
      ...b,
      remaining,
      low: remaining <= Math.ceil((b.toSeq - b.fromSeq + 1) * LOW_WATER_FRACTION),
      exhausted: remaining === 0,
    };
  });
}

/**
 * Numbers issued to a node and never used, per series, for a financial year.
 *
 * Unused numbers are acceptable when documented; this is the documentation. A
 * spent block whose `nextSeq` never reached `toSeq` left a gap, and so did a
 * block still open at year end.
 */
export async function gapRegister(storeId: string, financialYear: number): Promise<{
  docType: string; fromSeq: number; toSeq: number; unusedFrom: number; unusedTo: number; count: number;
}[]> {
  const rows = await db.numberBlock.findMany({
    where: { storeId, financialYear },
    orderBy: [{ docType: 'asc' }, { fromSeq: 'asc' }],
    select: { docType: true, fromSeq: true, toSeq: true, nextSeq: true },
  });

  return rows
    .filter((b) => b.nextSeq <= b.toSeq)
    .map((b) => ({
      docType: b.docType,
      fromSeq: b.fromSeq,
      toSeq: b.toSeq,
      unusedFrom: b.nextSeq,
      unusedTo: b.toSeq,
      count: b.toSeq - b.nextSeq + 1,
    }));
}

/** True when this node should fetch more numbers for a series while it can. */
export async function needsTopUp(
  storeId: string, docType: DocType, financialYear: number, nodeId: string | null,
): Promise<boolean> {
  const held = await db.numberBlock.findMany({
    where: { storeId, docType, financialYear, nodeId, exhaustedAt: null },
    select: { fromSeq: true, toSeq: true, nextSeq: true },
  });
  if (held.length === 0) return true;

  const remaining = held.reduce((n, b) => n + remainingOf(b), 0);
  const capacity = held.reduce((n, b) => n + (b.toSeq - b.fromSeq + 1), 0);
  return remaining <= Math.ceil(capacity * LOW_WATER_FRACTION);
}
