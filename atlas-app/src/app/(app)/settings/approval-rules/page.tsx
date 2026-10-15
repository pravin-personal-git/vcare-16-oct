import { requireContext } from '@/server/context';
import { isExcluded, moduleOfRequestType } from '@/lib/modules';
import { listRules, notificationDefaults, ruleChoices } from '@/server/approval-rules-admin';
import { ApprovalRulesClient } from './ApprovalRulesClient';

/** Settings > Approval Rules & Notifications (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §2, §4). */
export default async function ApprovalRulesPage() {
  const ctx = await requireContext();
  if (ctx.scope.kind !== 'single') {
    return <ApprovalRulesClient rows={[]} roles={[]} users={[]} defaults={null} storeName="" scopeIsAll />;
  }
  const storeId = ctx.scope.storeId;
  const [allRows, choices, defaults] = await Promise.all([listRules(storeId), ruleChoices(storeId), notificationDefaults(storeId)]);
  // Request types of a module switched off for this business are not offered (F-01).
  const rows = allRows.filter((r) => !isExcluded(moduleOfRequestType(r.type), ctx.excludedModules));
  const storeName = ctx.stores.find((s) => s.id === storeId)?.name ?? '';
  return <ApprovalRulesClient rows={rows} roles={choices.roles} users={choices.users} defaults={defaults} storeName={storeName} scopeIsAll={false} />;
}
