import { requireContext } from '@/server/context';
import { isPageOff } from '@/lib/modules';
import { SETTINGS_ENTRIES } from '@/lib/settings-registry';
import { settingsStatus } from '@/server/settings-status';
import { HubClient } from './HubClient';

/**
 * Settings hub (workstream A; the one door to every setting since 5 Oct 2026).
 *
 * The permission filter runs on the SERVER. Sending the whole registry and
 * hiding cards in the browser would tell anyone who opened dev tools exactly
 * which screens exist and what each one controls - a small leak, but the kind
 * that costs nothing to avoid and is awkward to explain afterwards. The setup
 * status is filtered the same way.
 */
export default async function SettingsHubPage() {
  const ctx = await requireContext();

  const entries = SETTINGS_ENTRIES.filter(
    (e) => (!e.permission || ctx.permissions.has(e.permission))
      // Settings of a module switched off for this business are not listed (F-01).
      && !isPageOff(e.route, ctx.excludedModules, ctx.excludedPages),
  );
  const allStatus = await settingsStatus(ctx);
  const status = Object.fromEntries(entries.filter((e) => e.key in allStatus).map((e) => [e.key, allStatus[e.key]]));

  return <HubClient entries={[...entries]} status={status} />;
}
