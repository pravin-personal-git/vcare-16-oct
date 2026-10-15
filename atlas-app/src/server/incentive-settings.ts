import 'server-only';
import { db } from './db';
import { DEFAULT_RULE, parseIncentiveRule, type IncentiveRule } from '@/lib/incentive-rules';

/**
 * A branch's incentive scheme (workstream H, 1 Oct 2026).
 *
 * Defaults to `manual` for every branch that has never set one - which is
 * exactly what Atlas did before this existed. Switching a client onto a
 * percentage has to be a decision somebody makes, never something that
 * happens to them on a deploy.
 */
export async function getIncentiveRule(storeId: string): Promise<IncentiveRule> {
  const row = await db.incentiveSettings.findUnique({
    where: { storeId },
    select: { rule: true },
  });
  return row ? parseIncentiveRule(row.rule) : { ...DEFAULT_RULE };
}

export async function saveIncentiveRule(
  storeId: string, value: unknown, userId: string | null,
): Promise<IncentiveRule> {
  const clean = parseIncentiveRule(value);
  await db.incentiveSettings.upsert({
    where: { storeId },
    create: { storeId, rule: clean as unknown as object, updatedBy: userId },
    update: { rule: clean as unknown as object, updatedBy: userId },
  });
  return clean;
}
