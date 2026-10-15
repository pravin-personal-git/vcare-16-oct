import { requireContext } from '@/server/context';
import { getIncentiveRule } from '@/server/incentive-settings';
import { DEFAULT_RULE } from '@/lib/incentive-rules';
import { IncentiveSettingsClient } from './IncentiveSettingsClient';

/** Settings > Sales incentive (workstream H). */
export default async function IncentiveSettingsPage() {
  const ctx = await requireContext();

  // The scheme belongs to a branch, so "All Company" has no honest answer.
  // Shown read-only rather than hidden, so the page is not a dead end.
  if (ctx.scope.kind !== 'single') {
    return <IncentiveSettingsClient initial={{ ...DEFAULT_RULE }} canEdit={false} />;
  }

  const rule = await getIncentiveRule(ctx.scope.storeId);
  return (
    <IncentiveSettingsClient
      initial={rule}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
