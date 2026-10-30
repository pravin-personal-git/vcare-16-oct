import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scorecardSettings } from '@/server/scorecard';
import { DEFAULT_SETTINGS, templateForRoleName } from '@/lib/scorecard/settings';
import { ScorecardSettingsClient } from './ScorecardSettingsClient';

/**
 * Settings > Scorecards (31 Oct 2026): which roles are scored as technicians
 * or office staff, the pillar weights, the limits, the office hygiene rules and
 * the reward rules. Per branch, like every other setup screen.
 */
export default async function ScorecardSettingsPage() {
  const ctx = await requireContext();
  const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : null;
  const [settings, roles] = await Promise.all([
    storeId ? scorecardSettings(storeId) : Promise.resolve(DEFAULT_SETTINGS),
    storeId ? db.role.findMany({ where: { storeId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
  ]);
  return (
    <ScorecardSettingsClient
      initial={settings}
      roles={roles.map((r) => ({ ...r, guess: templateForRoleName(r.name) }))}
      canEdit={!!storeId && ctx.permissions.has('settings.edit')}
      needsBranch={!storeId}
    />
  );
}
