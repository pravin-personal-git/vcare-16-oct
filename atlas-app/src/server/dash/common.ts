import 'server-only';
import type { SalesReach } from '../sales-reach';
import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { scopeWhere, userInScope, type StoreScope } from '../store-scope';
import { requestType } from '@/lib/approval-rules';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import {
  bucketsFor, compareRange, dayEnd, dayStart, istDay, istHour, rangeFor,
  type Bucket, type DashParams, type Day, type Granularity, type Range,
} from '@/lib/dash/period';

/**
 * What every dashboard builder is handed: the scope already narrowed to the
 * branch picked on the filter bar, the period, the comparison period and the
 * chart buckets - computed once in page.tsx so every card agrees on them.
 */
export interface DashCtx {
  scope: StoreScope;
  range: Range;
  prev: Range | null;
  buckets: Bucket[];
  gran: Granularity;
  today: Day;
  nowHour: number;
  now: Date;
  /** Whose quotations, orders and invoices this person sees (B4 step 3). Null = no limit. */
  sales?: SalesReach | null;
  /** Whose attendance and leave this person sees (B4 step 4, server/people-reach). Null = everyone. */
  people?: ReadonlySet<string> | null;
  /** Whose complaints count on the Service dashboard (B4 step 4, complaint-visibility). Null = all. */
  complaints?: Prisma.ComplaintWhereInput | null;
}

export function makeCtx(scope: StoreScope, p: DashParams, now = new Date()): DashCtx {
  const today = istDay(now);
  const nowHour = istHour(now);
  const range = rangeFor(p.period, today, p.from && p.to ? { from: p.from, to: p.to } : null);
  const { gran, list } = bucketsFor(range, today, nowHour);
  return { scope, range, prev: compareRange(range, p.compare), buckets: list, gran, today, nowHour, now };
}

/** `{ gte, lt }` for a range of India days. */
export const within = (r: Range) => ({ gte: dayStart(r.from), lt: dayEnd(r.to) });

/** Paise to rupees - the browser formats rupees. */
export const rs = (paise: number | null | undefined) => Math.round(paise ?? 0) / 100;

/**
 * Change against the comparison period, as a fraction (0.12 = up 12%).
 * Null when there is nothing to compare with: "up ∞%" from a zero is not a
 * figure anybody can act on, and a made-up one is worse.
 */
export function delta(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function partyName(p: { companyName?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!p) return '—';
  return p.companyName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || '—';
}

/** "4 min", "2 h", "3 days" since an instant. */
export function ago(at: Date, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "11 Oct" for an instant, on the India calendar. */
export function shortDate(at: Date): string {
  const d = istDay(at).split('-').map(Number);
  return `${d[2]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d[1] - 1]}`;
}

/** Whole India days from one instant to another. */
export function daysSince(at: Date, now: Date): number {
  return Math.max(0, Math.round((dayStart(istDay(now)).getTime() - dayStart(istDay(at)).getTime()) / 86_400_000));
}

/**
 * The balance of ledger accounts by code (debit minus credit), for the
 * scope, up to an instant. Cash in hand is 1010 and bank is 1020 - the codes
 * every receipt, payment and expense posts to.
 */
export async function ledgerBalance(scope: StoreScope, codes: string[], upTo?: Date): Promise<Map<string, number>> {
  const accounts = await db.account.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const out = new Map(codes.map((c) => [c, 0]));
  if (!accounts.length) return out;
  const grouped = await db.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: { ...scopeWhere(scope), ...(upTo ? { entryDate: { lt: upTo } } : {}) },
    },
    _sum: { debitPaise: true, creditPaise: true },
  });
  const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
  for (const g of grouped) {
    const code = codeOf.get(g.accountId)!;
    out.set(code, (out.get(code) ?? 0) + (g._sum.debitPaise ?? 0) - (g._sum.creditPaise ?? 0));
  }
  return out;
}

/**
 * The part of a target that falls inside a range: a monthly target of 6 lakh
 * seen over 11 days of that month counts as 11/31 of it. Lets one rule serve
 * every period on the filter bar.
 */
export function proratedTarget(
  targets: { periodStart: Date; periodEnd: Date; targetPaise: number }[], r: Range,
): number {
  const from = dayStart(r.from).getTime(); const to = dayEnd(r.to).getTime();
  let total = 0;
  for (const t of targets) {
    const s = t.periodStart.getTime(); const e = t.periodEnd.getTime() + 1;
    const overlap = Math.min(to, e) - Math.max(from, s);
    if (overlap <= 0 || e <= s) continue;
    total += t.targetPaise * (overlap / (e - s));
  }
  return total;
}

/** "What moved it": the biggest per-name changes between two periods. */
export function movers(cur: Map<string, number>, prev: Map<string, number>, n = 4): { label: string; v: number }[] {
  const names = new Set([...cur.keys(), ...prev.keys()]);
  return [...names]
    .map((k) => ({ label: k, v: rs((cur.get(k) ?? 0) - (prev.get(k) ?? 0)) }))
    .filter((m) => m.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, n);
}

export function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return m;
}

/** Store names for the branch chart. */
export async function storeNames(scope: StoreScope): Promise<Map<string, string>> {
  const ids = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const rows = await db.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((s) => [s.id, s.name]));
}

/** A cell for the drill-down tables. `_href` makes the first cell a link. */
export type Row = Record<string, string | number | null> & { _href?: string };

/**
 * Requests waiting for a decision, in the scope - one query.
 *
 * `waitingOn` (My Desk) works out, per request, exactly who may decide it:
 * the rule, its levels, the hierarchy, the owners. That is right for an inbox
 * and took 11-15 seconds on the dashboard. The dashboards are opened by the
 * owner and the managers who decide these, so the open requests themselves
 * are the honest count; deciding one still goes through the module's own
 * checks (`decideFromInbox`), so nobody approves what they may not.
 */
export async function pendingApprovals(scope: StoreScope) {
  const rows = await db.approvalRequest.findMany({
    where: { ...scopeWhere(scope), status: 'PENDING' },
    orderBy: { createdAt: 'asc' }, take: LIST_MAX_ROWS,
    select: { entityType: true, entityId: true, title: true, summary: true, amountPaise: true, href: true, createdAt: true, requestedBy: true },
  });
  const ids = [...new Set(rows.map((r) => r.requestedBy))];
  const users = ids.length ? await db.user.findMany({ where: { ...userInScope(scope), id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    const t = requestType(r.entityType);
    return {
      type: r.entityType, typeLabel: t?.label ?? r.entityType, entityId: r.entityId,
      title: r.title ?? t?.label ?? 'Request', summary: r.summary, amountPaise: r.amountPaise,
      href: r.href ?? t?.href(r.entityId) ?? '/my/reminders?tab=waiting',
      requesterName: nameOf.get(r.requestedBy) ?? 'Someone', since: r.createdAt,
    };
  });
}
