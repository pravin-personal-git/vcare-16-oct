import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { cleanStageConfig, DEFAULT_STAGES, stageName, type OrderStageConfig } from '@/lib/order-stages';
import type { FulfilmentStatus } from '@/lib/sales-order-status';

/**
 * Where a branch keeps its sales-order stages: one key in StoreConfig.values
 * (the per-branch settings record), so no migration and the rest of the
 * branch's settings are left as they are.
 */
const KEY = 'salesOrder.stages';

export async function getOrderStages(storeId: string): Promise<OrderStageConfig> {
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { values: true } });
  const v = row?.values && typeof row.values === 'object' && !Array.isArray(row.values) ? (row.values as Record<string, unknown>)[KEY] : undefined;
  return v === undefined ? DEFAULT_STAGES : cleanStageConfig(v);
}

/** For a scope: the single branch's stages, or the defaults on All Company. */
export async function orderStagesFor(scope: StoreScope): Promise<OrderStageConfig> {
  return scope.kind === 'single' ? getOrderStages(scope.storeId) : DEFAULT_STAGES;
}

/**
 * The business's own name for a stage, for screens that only need the words
 * (G3, 11 Oct 2026). Every label of an order's stage goes through this or
 * `stageName` - never `FULFILMENT_LABEL` directly (guard test
 * `stage-label-coverage`), or a renamed stage shows its old name.
 */
export async function stageNamer(scope: StoreScope): Promise<(s: string) => string> {
  const cfg = await orderStagesFor(scope);
  return (s) => stageName(cfg, s as FulfilmentStatus) ?? s.replace(/_/g, ' ');
}

export async function saveOrderStages(scope: StoreScope, raw: unknown): Promise<OrderStageConfig> {
  const storeId = scopeForWrite(scope);
  const cfg = cleanStageConfig(raw);
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { values: true } });
  const values = { ...((row?.values && typeof row.values === 'object' && !Array.isArray(row.values)) ? row.values as Record<string, unknown> : {}), [KEY]: cfg };
  await db.storeConfig.upsert({
    where: { storeId },
    create: { storeId, values: values as unknown as Prisma.InputJsonValue },
    update: { values: values as unknown as Prisma.InputJsonValue },
  });
  return cfg;
}
