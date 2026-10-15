import { requireContext } from '@/server/context';
import { storeConfigView } from '@/server/config';
import { CustomisationClient } from './CustomisationClient';

/**
 * Settings › Customisation (F1a, CONFIGURABILITY-SPEC.md §3.1).
 *
 * Generated from `lib/config-registry.ts`, not hand-written: an element added
 * to the registry appears here with no second commit, which is the whole point
 * of D15. Adding a screen for each new switch is how `ACCESS_KEYS` ended up
 * needing a developer for every client request.
 */
export default async function CustomisationPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind !== 'single') {
    return <CustomisationClient view={null} storeName="" canEdit={false} />;
  }

  const storeId = ctx.scope.storeId;
  return (
    <CustomisationClient
      view={await storeConfigView(ctx.scope)}
      storeName={ctx.stores.find((s) => s.id === storeId)?.name ?? ''}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
