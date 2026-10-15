/**
 * Is `date`'s calendar day and month due again within `windowDays` of
 * `today`, in whichever of this year or next year comes first - the
 * "recurring annual event" test for birthdays and work anniversaries, where
 * the stored date's YEAR is irrelevant (a 1990 date of birth is still "due"
 * every year) but wraps around New Year's like any other date arithmetic.
 */
export function withinUpcomingWindow(date: Date, today: Date, windowDays: number): boolean {
  const start = startOfDay(today);
  const thisYear = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  const next = thisYear < start ? new Date(today.getFullYear() + 1, date.getMonth(), date.getDate()) : thisYear;
  const diffDays = Math.round((next.getTime() - start.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= windowDays;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
