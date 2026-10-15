/**
 * The message a person sees when a save fails (27 Sep 2026).
 *
 * Before this, about sixty screens turned every unexpected error into
 * "Something went wrong" - including the one error that has a simple answer:
 * trying to save while the header says All Company, which is view only. A
 * complaint could not be assigned and nobody could tell why.
 *
 * `showMessage` keeps the old behaviour of screens that already showed the
 * error's own text (their errors are written for people).
 */
export const PICK_A_BRANCH = 'Pick a branch first (top bar). All Company is view only - it cannot save changes.';
export const READ_ONLY_BUSINESS = 'This business is in read-only mode - contact your account manager.';

export function friendlyError(e: unknown, showMessage = false): string {
  if (e instanceof Error && e.name === 'StoreScopeError') {
    return /read-only/i.test(e.message) ? READ_ONLY_BUSINESS : PICK_A_BRANCH;
  }
  if (showMessage && e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
