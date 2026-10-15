'use server';

import { requireContext } from '@/server/context';
import { getEntityMetrics, type MetricsEntity, type EntityMetrics } from '@/server/metrics';

export async function loadMetricsAction(entity: MetricsEntity): Promise<EntityMetrics> {
  const ctx = await requireContext();
  return getEntityMetrics(ctx.scope, entity);
}
