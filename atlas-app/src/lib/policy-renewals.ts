/**
 * Shared with the client for the same reason as `lib/tasks.ts` - a client
 * component cannot import a value from a `server-only` module.
 */
export const POLICY_TYPES = ['Insurance', 'Licence', 'Contract', 'AMC', 'Other'] as const;
