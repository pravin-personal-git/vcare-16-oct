/**
 * The AMC vocabulary, in lib/ rather than in server/amc.ts.
 *
 * WHY IT LIVES HERE
 *
 * `server/amc.ts` carries `import 'server-only'`, so a client component that
 * reads a runtime value from it fails the build - and the failure is a module
 * resolution error a long way from the cause. These labels and status lists
 * are needed by the screen (a badge, a dropdown) and by the server (validating
 * a transition), so they belong in the layer both can import.
 *
 * `server-only-boundary.test.ts` asserts exactly this, which is how the
 * mistake was caught rather than discovered at deploy time.
 */

export const AMC_STATUSES = ['draft', 'active', 'expired', 'cancelled'] as const;
export type AmcStatus = (typeof AMC_STATUSES)[number];

export const AMC_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const COVERAGE_TERMS = ['labour_only', 'parts_and_labour'] as const;
export type CoverageTerms = (typeof COVERAGE_TERMS)[number];

export const COVERAGE_TERMS_LABEL: Record<string, string> = {
  labour_only: 'Labour only',
  parts_and_labour: 'Parts and labour',
};

/**
 * What may follow what.
 *
 * `draft -> active` is the act of the contract starting to mean something, so
 * it is explicit rather than inferred from the start date - a contract typed
 * in ahead of time should not begin covering work because a date passed while
 * nobody had checked the details.
 *
 * `expired -> active` is allowed on purpose. A customer who renews late is
 * still a customer, and somebody has to be able to say so. `cancelled` is the
 * one terminal state: it means the agreement ended rather than lapsed, and
 * un-cancelling would erase why.
 */
export const AMC_TRANSITIONS: Record<AmcStatus, AmcStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['expired', 'cancelled'],
  expired: ['active', 'cancelled'],
  cancelled: [],
};
