/**
 * TOMBSTONES INSTEAD OF HARD DELETES (3 Oct 2026).
 *
 * ## Why this had to be central
 *
 * Twenty-nine models still removed their rows outright. Converting each one means
 * every READ of it has to exclude the dead rows, or a deleted category turns up in
 * a product dropdown. Those reads number about 170 across the codebase, and doing
 * them one at a time is how you miss four and ship a regression to a live client -
 * which is precisely why this debt was ratcheted rather than paid.
 *
 * So the filter goes in ONE place: the database client every query already passes
 * through. A new read of a tombstoned model is filtered the day it is written,
 * by nobody having to remember.
 *
 * ## What is filtered, and what is deliberately not
 *
 * TOP-LEVEL reads only. A nested relation read - `include: { category: true }` on
 * a product - is left alone, and that is the correct behaviour rather than a
 * limitation we are living with:
 *
 *   - a deleted category must NOT be selectable on a new product. That is a
 *     top-level `findMany`, and it is filtered.
 *   - a deleted category MUST still show its name on the invoice raised last
 *     March. That is a relation read, and it is not filtered.
 *
 * The old hard delete could not do the second thing at all. It had to either
 * refuse the delete or null the reference, so history lost the name. Tombstones
 * plus unfiltered relation reads is strictly better.
 *
 * ## The escape hatch
 *
 * A caller that mentions `deletedAt` itself gets exactly what it asked for -
 * `deletedAt: { not: null }` to list what was deleted, or `undefined` to see
 * everything. The audit viewer and any future restore screen need that, and a
 * filter with no way round it would be worked around by a raw query, which is
 * worse.
 *
 * ## Why not every model
 *
 * Only models that actually tombstone are listed. Applying it to a model whose
 * `deletedAt` is never written costs a clause on every query for nothing, and
 * applying it to one that genuinely hard-deletes would hide nothing while
 * suggesting it does.
 */

/**
 * The models whose rows are tombstoned and must be filtered out of top-level
 * reads.
 *
 * Prisma delegate names, camelCase, because that is what the extension sees.
 * `sync-tombstone-coverage.test.ts` checks this against the registry and against
 * the remaining hard deletes, so the list cannot drift from reality.
 */
export const SOFT_DELETED_MODELS: readonly string[] = [
  // Masters. Deleted only when nothing references them yet - but "nothing
  // references them" was checked on one machine, and after F3 there are two.
  'category', 'brand', 'customerType', 'leadStage', 'leadSource', 'leadDealStage',
  'paymentType', 'taxRate', 'warehouse', 'department', 'tncTemplate', 'holiday',
  'bankAccount', 'helpdeskFaqCategory', 'helpdeskFaq', 'userTarget',

  // Config. A deleted role coming back grants permissions somebody removed on
  // purpose, which is the worst failure in this list.
  'role', 'approvalRule', 'entityFieldConfig',

  // Documents. A deleted document that resurrects puts a number back into a
  // series already accounted for - and two of these are money.
  'documentAttachment', 'approvalChain', 'notice', 'supplierDebitNote',
  'personalReminder', 'sharedFile', 'staffTransaction', 'task', 'transaction',

  // Append-only. A note should never have been deletable at all.
  'leadNote',
];

const SOFT = new Set(SOFT_DELETED_MODELS);

export const isSoftDeleted = (model: string | undefined): boolean =>
  model !== undefined && SOFT.has(model.charAt(0).toLowerCase() + model.slice(1));

/** Top-level read operations that accept a `where`. */
export const FILTERED_READS: readonly string[] = [
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
];

/**
 * Add `deletedAt: null` to a read's arguments, unless the caller already said
 * something about `deletedAt`.
 *
 * Returns the same object when there is nothing to do, so an unaffected query
 * allocates nothing.
 */
export function withoutDeleted<T>(args: T): T {
  const a = (args ?? {}) as { where?: Record<string, unknown> };
  const where = a.where;

  // Already explicit - the caller wins. See "the escape hatch" at the top.
  if (where && 'deletedAt' in where) return args;

  /**
   * An OR at the top level is left alone on purpose.
   *
   * `{ OR: [...] }` with `deletedAt: null` added beside it reads as
   * "(a OR b) AND not deleted", which is what anybody would want - so this does
   * add it. The case that would be wrong is a caller putting `deletedAt` inside
   * one branch of the OR, and the `in` check above only sees the top level. No
   * query in this codebase does that, and if one ever does it will be visibly
   * wrong rather than subtly so.
   */
  return { ...(args as object), where: { ...(where ?? {}), deletedAt: null } } as T;
}

/**
 * `findUnique` is NOT rewritten, and that is the fix for a real bug.
 *
 * The first version of this (3 Oct 2026) turned `findUnique` into `findFirst` so
 * it could add `deletedAt: null` to the `where` - `findUnique` refuses a
 * non-unique field there. It broke Settings > Approval Rules in production
 * within hours, with "This page could not be loaded".
 *
 * The reason: `findUnique` accepts a COMPOUND unique key as a nested object,
 *
 *     where: { storeId_requestType: { storeId, requestType } }
 *
 * and `findFirst` has no such argument. Prisma rejects the whole call with
 * "Unknown argument `storeId_requestType`". Any model with an `@@unique([a, b])`
 * read by its compound key was broken, and only one in this codebase was -
 * which is exactly how it reached production: the pages that use a plain `id`
 * all worked, so the smoke test passed.
 *
 * So `findUnique` now runs UNCHANGED and the row is dropped afterwards if it is
 * tombstoned. One extra object read, no guessing at Prisma's `where` grammar,
 * and nothing to get wrong the next time somebody adds a compound key.
 */

/** Operations whose result is filtered after the fact rather than in SQL. */
export const POST_FILTERED_READS: readonly string[] = ['findUnique', 'findUniqueOrThrow'];

/**
 * Make sure `deletedAt` comes back, so the result can be judged.
 *
 * Only matters when the caller passed `select` - with `include`, or with neither,
 * every scalar is returned anyway. Reports whether it had to add the field, so
 * the caller can take it back out and hand over exactly what was asked for.
 */
export function ensureDeletedAtSelected<T>(args: T): { args: T; added: boolean } {
  const a = (args ?? {}) as { select?: Record<string, unknown> };
  if (!a.select || 'deletedAt' in a.select) return { args: args ?? ({} as T), added: false };
  return {
    args: { ...(args as object), select: { ...a.select, deletedAt: true } } as T,
    added: true,
  };
}

/**
 * Judge a `findUnique` result.
 *
 * `undefined` for `deletedAt` reads as NOT deleted. That is the safe direction
 * here: it can only happen if a caller explicitly omitted the column, and
 * hiding a row because we could not see its state would make rows vanish for a
 * reason nobody could trace.
 */
export function isTombstoned(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const v = (row as { deletedAt?: unknown }).deletedAt;
  return v !== null && v !== undefined;
}

/** Hand back exactly what was asked for, without the column we added. */
export function stripAddedDeletedAt<T>(row: T, added: boolean): T {
  if (!added || !row || typeof row !== 'object') return row;
  const copy = { ...(row as object) } as Record<string, unknown>;
  delete copy.deletedAt;
  return copy as T;
}
