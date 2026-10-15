import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';

/**
 * The "Metrics" toolbar button, present on eight list screens as a stub since
 * the screens were built. A bespoke dashboard per module (funnel charts for
 * Leads, aging for Invoices, and so on) is real future work - this is the
 * generic version every one of the eight can share today: how many new
 * records landed per day over the last 30 days, and whether that is trending
 * up or down against the 30 days before it. Same shape, same honesty level,
 * for all eight - the summary cards already on each screen remain the place
 * for anything module-specific.
 */

export type MetricsEntity =
  | 'Lead' | 'Customer' | 'Supplier' | 'Product' | 'Invoice' | 'SalesOrder' | 'Quotation' | 'UserTarget';

export interface EntityMetrics {
  total: number;
  last30: number;
  prior30: number;
  /** null when there is nothing in the prior window to compare against - a
   * percentage against zero is not a real number. */
  trendPct: number | null;
  daily: { date: string; count: number }[];
}

async function timestamps(scope: StoreScope, entity: MetricsEntity, since: Date): Promise<Date[]> {
  const where = { ...scopeWhere(scope), createdAt: { gte: since } };
  switch (entity) {
    case 'Lead':
      return (await db.lead.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'Customer':
      return (await db.party.findMany({ where: { ...where, isCustomer: true }, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'Supplier':
      return (await db.party.findMany({ where: { ...where, isSupplier: true }, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'Product':
      return (await db.product.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'Invoice':
      return (await db.invoice.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'SalesOrder':
      return (await db.salesOrder.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'Quotation':
      return (await db.quotation.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    case 'UserTarget':
      return (await db.userTarget.findMany({ where, select: { createdAt: true } })).map((r) => r.createdAt);
    default: {
      const never: never = entity;
      throw new Error(`Unknown metrics entity: ${String(never)}`);
    }
  }
}

async function totalCount(scope: StoreScope, entity: MetricsEntity): Promise<number> {
  const where = scopeWhere(scope);
  switch (entity) {
    case 'Lead': return db.lead.count({ where });
    case 'Customer': return db.party.count({ where: { ...where, isCustomer: true } });
    case 'Supplier': return db.party.count({ where: { ...where, isSupplier: true } });
    case 'Product': return db.product.count({ where });
    case 'Invoice': return db.invoice.count({ where });
    case 'SalesOrder': return db.salesOrder.count({ where });
    case 'Quotation': return db.quotation.count({ where });
    case 'UserTarget': return db.userTarget.count({ where });
    default: {
      const never: never = entity;
      throw new Error(`Unknown metrics entity: ${String(never)}`);
    }
  }
}

export async function getEntityMetrics(scope: StoreScope, entity: MetricsEntity): Promise<EntityMetrics> {
  const now = new Date();
  const day = 86_400_000;
  const sixtyDaysAgo = new Date(now.getTime() - 60 * day);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * day);

  const [rows, total] = await Promise.all([timestamps(scope, entity, sixtyDaysAgo), totalCount(scope, entity)]);

  const last30 = rows.filter((d) => d >= thirtyDaysAgo).length;
  const prior30 = rows.length - last30;

  const daily: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(now.getTime() - i * day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + day);
    const count = rows.filter((d) => d >= dayStart && d < dayEnd).length;
    daily.push({ date: dayStart.toISOString().slice(0, 10), count });
  }

  return {
    total,
    last30,
    prior30,
    trendPct: prior30 > 0 ? Math.round(((last30 - prior30) / prior30) * 100) : null,
    daily,
  };
}
