import 'server-only';
import { db } from './db';
import { scopeWhere, userInScope } from './store-scope';
import type { AppContext } from './context';

/**
 * Has each setting been filled in? For the Settings page (5 Oct 2026).
 *
 * One cheap question per screen - "is there at least one row?" - so the page
 * can say Set / Not yet beside each card and show how far setup has got. A
 * screen whose "done" cannot be told from a count (System Configuration,
 * Appearance - they always have defaults) gets no badge rather than a guess.
 *
 * Every check is allowed to fail on its own: a status badge going missing is
 * fine, the Settings page failing to open is not.
 */
export async function settingsStatus(ctx: AppContext): Promise<Record<string, boolean>> {
  const store = scopeWhere(ctx.scope);
  const orgId = ctx.organization.id;
  const any = (n: number) => n > 0;

  const checks: Record<string, () => Promise<boolean>> = {
    organization: async () => Boolean((await db.organization.findUnique({ where: { id: orgId }, select: { logoPath: true } }))?.logoPath),
    'legal-entities': async () => any(await db.legalEntity.count({ where: { organizationId: orgId } })),
    'chart-of-accounts': async () => any(await db.account.count({ where: { organizationId: orgId } })),
    'opening-balance': async () => any(await db.openingBalance.count({ where: store })),
    'period-lock': async () => any(await db.accountingPeriod.count({ where: store })),
    'bank-accounts': async () => any(await db.bankAccount.count({ where: store })),
    masters: async () => any(await db.category.count({ where: store })),
    courier: async () => any(await db.courier.count({ where: store })),
    'user-target': async () => any(await db.userTarget.count({ where: store })),
    documents: async () => any(await db.documentTemplate.count({ where: store })),
    'custom-fields': async () => any(await db.entityFieldConfig.count({ where: store })),
    'approval-rules': async () => any(await db.approvalRule.count({ where: store })),
    users: async () => (await db.user.count({ where: { isActive: true, ...userInScope(ctx.scope) } })) > 1,
    departments: async () => any(await db.department.count({ where: store })),
    'team-setup': async () => any(await db.user.count({ where: { isActive: true, reportsToId: { not: null }, ...userInScope(ctx.scope) } })),
    'clock-in-rules': async () => any(await db.attendanceZone.count({ where: store })),
    'work-schedules': async () => any(await db.workType.count({ where: store })),
    'attendance-devices': async () => any(await db.attendanceDevice.count({ where: store })),
    'call-devices': async () => any(await db.callSyncDevice.count({ where: store })),
    'api-tokens': async () => any(await db.apiToken.count({ where: { organizationId: orgId } })),
  };

  const out: Record<string, boolean> = {};
  await Promise.all(Object.entries(checks).map(async ([key, check]) => {
    try { out[key] = await check(); } catch { /* no badge for this one */ }
  }));
  return out;
}
