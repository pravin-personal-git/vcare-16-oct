import 'server-only';
import { costsFor } from './product-cost';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import type { LedgerLineInput } from '@/lib/ledger';

/**
 * Cost of Goods Sold - posted perpetually, at the moment stock physically
 * leaves or comes back, never at invoice-issue. Decided 16 Sep 2026 (see
 * PLATFORM-COMPLETION.md, "COGS timing"): the purchase side already posts
 * value and stock together via GRN, so the sale side matches it rather than
 * lagging or leading the actual stock movement by however long an invoice
 * sits unissued.
 *
 * Always its own journal entry (`sourceType: 'cogs'`), never merged into the
 * revenue-side one - a dispatch and its invoice can happen in either order
 * or not at all together, and merging them would tie two independent facts
 * to one posting.
 *
 * Cost basis is whatever `costsFor`/`Store.costMethod` already resolves -
 * the same figure `profitAndLoss` reads. If it resolves to zero (nothing
 * bought yet, no standard cost set), nothing is posted: a fake zero-value
 * entry would be worse than the honest gap the Products screen already
 * surfaces for an unpriced product.
 */

export interface CogsLine {
  productId: string;
  qty: number;
}

export type CogsDirection = 'out' | 'in';

export interface PostCogsInput {
  direction: CogsDirection;
  entryDate: Date;
  description: string;
  sourceId: string;
  lines: CogsLine[];
}

export async function postCogsMovement(
  scope: StoreScope,
  input: PostCogsInput,
  userId: string,
): Promise<void> {
  // Services have no cost of goods (B0) - only goods leave the shelf.
  const goods = new Set((await db.product.findMany({
    where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] }, ...scopeWhere(scope), kind: 'goods' },
    select: { id: true },
  })).map((p) => p.id));
  input = { ...input, lines: input.lines.filter((l) => goods.has(l.productId)) };
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  if (productIds.length === 0) return;

  // Every caller posts at most once per sourceId in its normal flow (one
  // dispatch, one direct invoice, one return receipt) - guarded the same way
  // `postInvoiceJournal` is, so a retry after a later step fails doesn't
  // post a second COGS entry for the same physical movement.
  const already = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'cogs', sourceId: input.sourceId },
    select: { id: true },
  });
  if (already) return;

  const costs = await costsFor(scope, productIds);
  const totalPaise = input.lines.reduce(
    (n, l) => n + (costs.get(l.productId)?.unitCostPaise ?? 0) * l.qty,
    0,
  );
  if (totalPaise <= 0) return;

  const lines: LedgerLineInput[] = input.direction === 'out'
    ? [
      { accountCode: '5010', debitPaise: totalPaise },
      { accountCode: '1200', creditPaise: totalPaise },
    ]
    : [
      { accountCode: '1200', debitPaise: totalPaise },
      { accountCode: '5010', creditPaise: totalPaise },
    ];

  await postJournalEntry(scope, {
    entryDate: input.entryDate,
    description: input.description,
    sourceType: 'cogs',
    sourceId: input.sourceId,
    lines,
  }, userId);
}

/**
 * Reverse a COGS entry already posted for this source - used when undoing
 * the SAME event that posted it (an order un-dispatched, a return
 * cancelled), never for a later, separate economic event like a sales
 * return against an old invoice, which posts its own fresh entry via
 * `postCogsMovement` instead. Does nothing if no entry exists - a draft
 * that never moved stock never posted one either.
 */
export async function reverseCogsMovement(
  scope: StoreScope,
  sourceId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'cogs', sourceId, reversalOfId: null },
    select: { id: true },
  });
  if (!entry) return;
  await reverseJournalEntry(scope, entry.id, userId, reason);
}
