/**
 * Is a disciplinary action's login block still in effect right now.
 *
 * `durationDays` null means no defined end - a dismissal, which has nothing
 * to "expire" - so it blocks from `startDate` onward, forever. A duration
 * blocks for exactly that many days from `startDate`, then lifts on its own
 * without anyone having to remember to re-enable the account.
 */
export function isBlockActive(action: { startDate: Date; durationDays: number | null }, now: Date): boolean {
  if (now < action.startDate) return false;
  if (action.durationDays === null) return true;
  const end = new Date(action.startDate);
  end.setDate(end.getDate() + action.durationDays);
  return now < end;
}
