/**
 * Store scoping.
 *
 * The highest-severity bug class in this product is a query that forgets its
 * store scope and leaks one tenant's data to another. Every read and write of a
 * transactional table goes through here.
 *
 * Rules:
 *  1. The store id comes from the session. NEVER from a client-supplied param.
 *  2. "All Company" mode aggregates across the user's stores - it does not
 *     bypass scoping, it widens it to a known set.
 *  3. A query with no scope is a bug, not a feature. There is no escape hatch.
 *
 * Spec: 03-technical-docs/01-specification/00-architecture.md §2
 */

export type StoreScope =
  | { kind: 'single'; storeId: string; writable: boolean }
  | { kind: 'all'; storeIds: string[]; writable: boolean };

export class StoreScopeError extends Error {
  /** `plain`: the message is written for the person on screen, not for a log. */
  constructor(message: string, plain = false) {
    super(plain ? message : `[store-scope] ${message}`);
    this.name = 'StoreScopeError';
  }
}

/**
 * Build a scope from the session's active store, or All Company mode.
 *
 * `writable` (superadmin-roadmap Slice 6, D051) defaults `true` so every
 * pre-existing caller's behaviour is unchanged - only `context.ts` passes
 * `false`, and only when the tenant's own `lifecycleState` is `READ_ONLY`
 * (or worse). This is the ONE place that decides it; `scopeForWrite()`
 * below just enforces whatever this function already decided, the same
 * way it already enforces "All Company mode cannot write" - a tenant going
 * read-only needs no changes at any of the ~58 call sites that already
 * call `scopeForWrite()` before writing.
 */
export function resolveScope(
  activeStoreId: string | null,
  accessibleStoreIds: string[],
  writable = true,
): StoreScope {
  if (accessibleStoreIds.length === 0) {
    throw new StoreScopeError('user has access to no stores');
  }
  if (activeStoreId === null) {
    return { kind: 'all', storeIds: accessibleStoreIds, writable };
  }
  if (!accessibleStoreIds.includes(activeStoreId)) {
    throw new StoreScopeError(
      `active store ${activeStoreId} is not in the user's accessible set`,
    );
  }
  return { kind: 'single', storeId: activeStoreId, writable };
}

/** Stored value of User.lastStoreChoice meaning "All Company". */
export const ALL_COMPANY_CHOICE = 'all';

/**
 * Which branch a person's pages open in (27 Sep 2026).
 *
 * - Their saved choice, if it is still one of their branches.
 * - "all" (All Company) only if they chose it themselves and have more than one branch.
 * - Otherwise their home branch: the first one they were assigned to. Never
 *   All Company by default - that view cannot save anything, and landing in
 *   it made saves fail with no obvious reason.
 */
export function pickStartStore(
  choice: string | null | undefined,
  assignments: { storeId: string; assignedAt?: Date | null }[],
): string | null {
  const ids = new Set(assignments.map((a) => a.storeId));
  if (ids.size === 0) return null;
  if (choice && ids.has(choice)) return choice;
  if (choice === ALL_COMPANY_CHOICE && ids.size > 1) return null;
  const first = [...assignments].sort(
    (a, b) => (a.assignedAt?.getTime() ?? 0) - (b.assignedAt?.getTime() ?? 0),
  )[0];
  return first.storeId;
}

/** Prisma `where` fragment. Spread this into every query on a scoped table. */
export function scopeWhere(scope: StoreScope): { storeId: string } | { storeId: { in: string[] } } {
  return scope.kind === 'single'
    ? { storeId: scope.storeId }
    : { storeId: { in: scope.storeIds } };
}

/**
 * Scope fragment for `User`, which carries no `storeId` of its own.
 *
 * A person belongs to stores through `UserStoreRole`, so scoping a user query
 * means a relation filter rather than a column filter. Written once here
 * because the hand-rolled version went wrong in the way this module exists to
 * prevent: `listTechnicians` in complaints.ts used
 * `scope.kind === 'all' ? {} : { storeRoles: { some: { storeId: scope.storeId } } }`,
 * and All Company therefore returned every user in the database - other
 * tenants' staff, listed in a dropdown and assignable. Rule 2 above says All
 * Company widens the set; it does not remove it. `scopeWhere` already handles
 * both kinds, so there is no branch to get wrong.
 *
 * Use this for any query whose RESULT is a list of people. A query that
 * resolves a known set of ids (`where: { id: { in: ids } }`) taken off rows
 * that were themselves scoped does not need it - the ids are the scope.
 */
export function userInScope(scope: StoreScope): {
  storeRoles: { some: { storeId: string } | { storeId: { in: string[] } } };
} {
  return { storeRoles: { some: scopeWhere(scope) } };
}

/**
 * Writes always target exactly one store. All Company is a read-only view -
 * and, since Slice 6, so is a tenant whose `lifecycleState` is `READ_ONLY`
 * (or `SUSPENDED`/`TERMINATED`, though those are already blocked at login;
 * this is the defense-in-depth backstop for a session already open when
 * the state changes underneath it). Covers every one of the ~58
 * `scopeForWrite()` call sites automatically - real, meaningful coverage
 * of the bulk of this product's transactional writes, but NOT literally
 * every write path in the app (a handful of files - linked-accounts,
 * messages, a few others - write without going through this function; see
 * the superadmin-roadmap status notes for the honest list). Flagged as a
 * known gap, not silently assumed complete.
 */
export function scopeForWrite(scope: StoreScope): string {
  if (scope.kind === 'all') {
    throw new StoreScopeError('Pick a branch first (top bar). All Company is view only - it cannot save changes.', true);
  }
  if (!scope.writable) {
    throw new StoreScopeError('This business is in read-only mode - contact your account manager.', true);
  }
  return scope.storeId;
}
