import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { getFinancialYear } from '@/lib/financial-year';
import { REVENUE_ORDER_WHERE } from '@/lib/revenue';
import {
  achievementPct, fyPeriod, incentivePaise, periodsForFy,
  type Period, type PeriodType,
} from '@/lib/target-period';

/**
 * Sales targets and achievement.
 *
 * Achievement is never stored. It is the sum of that salesperson's orders in
 * the period, computed on read - because a stored achievement figure goes stale
 * the moment an order is cancelled, and nobody remembers to recompute it.
 *
 * Spec: 05-sales-orders-invoices.md §3
 */

export interface TargetRow {
  id: string | null;
  userId: string;
  name: string;
  username: string;
  periodType: PeriodType;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  targetPaise: number;
  achievedPaise: number;
  orderCount: number;
  achievementPct: number | null;
  gapPaise: number;
  incentivePct: number;
  incentivePaise: number;
}

export interface TargetsView {
  fy: number;
  rows: TargetRow[];
  periods: Period[];
  totals: {
    targetPaise: number;
    achievedPaise: number;
    achievementPct: number | null;
    incentivePaise: number;
  };
}

/**
 * Targets and achievement for a period.
 *
 * Every user with a role in scope appears, whether or not a target has been set
 * - otherwise "who has no target" is a question the screen cannot answer, and
 * that is usually the question worth asking.
 */
export async function getTargets(
  scope: StoreScope,
  opts: { fy?: number; periodType?: PeriodType; periodStart?: Date } = {},
): Promise<TargetsView> {
  const fy = opts.fy ?? getFinancialYear();
  const periods = periodsForFy(fy);

  const periodType = opts.periodType ?? 'fy';
  const period =
    periods.find(
      (p) =>
        p.type === periodType
        && (!opts.periodStart || p.start.getTime() === opts.periodStart.getTime()),
    ) ?? periods[0];

  const [assignments, targets, orders] = await db.$transaction([
    // Only people who actually hold a role in this scope. A user from another
    // store has no business appearing on this store's target sheet.
    db.userStoreRole.findMany({
      where: scopeWhere(scope),
      select: { userId: true, user: { select: { id: true, fullName: true, username: true } } },
      distinct: ['userId'],
    }),
    db.userTarget.findMany({
      where: {
        ...scopeWhere(scope),
        periodType: period.type,
        periodStart: period.start,
      },
    }),
    db.salesOrder.findMany({
      where: {
        ...scopeWhere(scope),
        orderDate: { gte: period.start, lte: period.end },
        // A cancelled or failed order is not a sale, so it does not count
        // towards anyone's number.
        ...REVENUE_ORDER_WHERE,
      },
      select: { salespersonId: true, grandTotalPaise: true },
    }),
  ]);

  const achieved = new Map<string, { paise: number; count: number }>();
  for (const o of orders) {
    if (!o.salespersonId) continue;
    const cur = achieved.get(o.salespersonId) ?? { paise: 0, count: 0 };
    achieved.set(o.salespersonId, {
      paise: cur.paise + o.grandTotalPaise,
      count: cur.count + 1,
    });
  }

  const targetByUser = new Map(targets.map((t) => [t.userId, t]));

  const rows: TargetRow[] = assignments
    .map((a) => {
      const t = targetByUser.get(a.userId);
      const got = achieved.get(a.userId) ?? { paise: 0, count: 0 };
      const targetPaise = t?.targetPaise ?? 0;
      const pct = Number(t?.incentivePct ?? 0);

      return {
        id: t?.id ?? null,
        userId: a.userId,
        name: a.user.fullName,
        username: a.user.username,
        periodType: period.type,
        periodLabel: period.label,
        periodStart: period.start,
        periodEnd: period.end,
        targetPaise,
        achievedPaise: got.paise,
        orderCount: got.count,
        achievementPct: achievementPct(got.paise, targetPaise),
        gapPaise: targetPaise - got.paise,
        incentivePct: pct,
        incentivePaise: incentivePaise(got.paise, pct),
      };
    })
    .sort((a, b) => b.achievedPaise - a.achievedPaise);

  const targetTotal = rows.reduce((n, r) => n + r.targetPaise, 0);
  const achievedTotal = rows.reduce((n, r) => n + r.achievedPaise, 0);

  return {
    fy,
    rows,
    periods,
    totals: {
      targetPaise: targetTotal,
      achievedPaise: achievedTotal,
      achievementPct: achievementPct(achievedTotal, targetTotal),
      incentivePaise: rows.reduce((n, r) => n + r.incentivePaise, 0),
    },
  };
}

export async function setTarget(
  scope: StoreScope,
  input: {
    userId: string;
    periodType: PeriodType;
    periodStart: Date;
    periodEnd: Date;
    periodLabel: string;
    targetPaise: number;
    incentivePct: number;
    note?: string | null;
  },
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  if (input.targetPaise < 0) throw new Error('A target cannot be negative.');
  if (input.incentivePct < 0 || input.incentivePct > 100) {
    throw new Error('Incentive must be between 0 and 100 percent.');
  }

  // The person must actually hold a role in this store. Setting a target for
  // someone who does not work here is a data-entry accident, not a feature.
  const holdsRole = await db.userStoreRole.findFirst({
    where: { storeId, userId: input.userId },
    select: { userId: true },
  });
  if (!holdsRole) {
    throw new Error('That person does not hold a role in this store.');
  }

  return db.userTarget.upsert({
    where: {
      storeId_userId_periodType_periodStart: {
        storeId,
        userId: input.userId,
        periodType: input.periodType,
        periodStart: input.periodStart,
      },
    },
    update: {
      targetPaise: input.targetPaise,
      incentivePct: input.incentivePct,
      periodEnd: input.periodEnd,
      periodLabel: input.periodLabel,
      note: input.note ?? null,
    },
    create: {
      storeId,
      userId: input.userId,
      periodType: input.periodType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      periodLabel: input.periodLabel,
      targetPaise: input.targetPaise,
      incentivePct: input.incentivePct,
      note: input.note ?? null,
      createdBy: userId,
    },
  });
}

export async function removeTarget(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const t = await db.userTarget.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (!t) throw new Error('Target not found in your scope.');
  // Tombstoned, not removed (3 Oct 2026). A target that resurrects changes what
  // somebody's incentive was measured against, after it was paid.
  return db.userTarget.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}

/**
 * Month-by-month achievement against target, for the report tab and the
 * dashboard's "Monthly Revenue vs Target" chart.
 */
export async function getMonthlyReport(scope: StoreScope, fy?: number) {
  const year = fy ?? getFinancialYear();
  // The target year - India midnight, like the target months it is sliced into.
  const { start, end } = fyPeriod(year);
  const months = periodsForFy(year).filter((p) => p.type === 'month');

  const [orders, targets] = await db.$transaction([
    db.salesOrder.findMany({
      where: {
        ...scopeWhere(scope),
        orderDate: { gte: start, lte: end },
        ...REVENUE_ORDER_WHERE,
      },
      select: { orderDate: true, grandTotalPaise: true },
    }),
    db.userTarget.findMany({
      where: { ...scopeWhere(scope), periodType: 'month', periodStart: { gte: start, lte: end } },
      select: { periodStart: true, targetPaise: true },
    }),
  ]);

  return months.map((m) => ({
    label: m.label,
    targetPaise: targets
      .filter((t) => t.periodStart.getTime() === m.start.getTime())
      .reduce((n, t) => n + t.targetPaise, 0),
    achievedPaise: orders
      .filter((o) => o.orderDate >= m.start && o.orderDate <= m.end)
      .reduce((n, o) => n + o.grandTotalPaise, 0),
  }));
}
