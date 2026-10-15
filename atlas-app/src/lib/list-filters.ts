import { resolveRange, type DateRange, type RangePreset } from './date-ranges';

/**
 * The filters every list screen shares (F1 UI standard), read from the
 * address. Screen-specific ones (a status card, a warehouse) stay with the
 * screen; these are the ones FilterBar draws and "Clear all" removes.
 *
 *   ?q=        search text (see lib/server-grid)
 *   ?range= &from= &to=   date range (see lib/date-ranges)
 *   ?person=   'me' or a user id - "Assigned to me" / a person
 */
export interface ListFilters {
  range: DateRange;
  /** The user id to filter on, already resolved from 'me'; null = everyone. */
  personId: string | null;
  /** True when the person filter is the viewer themself. */
  mine: boolean;
}

/** Every address key FilterBar owns - "Clear all" deletes these plus the screen's own. */
export const LIST_FILTER_KEYS = ['q', 'range', 'from', 'to', 'person', 'page'] as const;

type Sp = Record<string, string | string[] | undefined>;
const one = (sp: Sp, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

export function parseListFilters(
  sp: Sp,
  opts: {
    defaultRange: Exclude<RangePreset, 'custom'>;
    meId: string;
    now?: Date;
    /**
     * No ?person= means "Assigned to me" rather than everyone - for staff who
     * mostly look at their own work (Task Manager for people who don't hand
     * tasks out). ?person=all then means everyone.
     */
    defaultMine?: boolean;
  },
): ListFilters {
  const raw = one(sp, 'person');
  const person = (raw ?? (opts.defaultMine ? 'me' : '')).trim();
  const personId = person === 'me' ? opts.meId
    : person === 'all' ? null
      : person && /^[A-Za-z0-9_-]{1,64}$/.test(person) ? person : null;
  return {
    range: resolveRange({ range: one(sp, 'range'), from: one(sp, 'from'), to: one(sp, 'to') }, opts.defaultRange, opts.now),
    personId,
    mine: !!personId && personId === opts.meId,
  };
}

/**
 * Screens that used ?days=1|7|30|N before F1 (Call Logs, Shift Log) keep their
 * old links working: the number becomes the matching preset, or a custom
 * range from N-1 days ago. An explicit range/from/to wins.
 */
export function daysToRange(sp: Sp, istToday: (d: Date) => string, now = new Date()): Sp {
  if (one(sp, 'range') || one(sp, 'from') || one(sp, 'to') || !one(sp, 'days')) return sp;
  const d = Math.min(90, Math.max(1, Number(one(sp, 'days')) || 7));
  if (d === 1) return { ...sp, range: 'today' };
  if (d === 7) return { ...sp, range: 'last_7_days' };
  if (d === 30) return { ...sp, range: 'last_30_days' };
  return { ...sp, range: 'custom', from: istToday(new Date(now.getTime() - (d - 1) * 86_400_000)) };
}
