import { requireContext } from '@/server/context';
import { getJobSettings } from '@/server/job-settings';
import { FieldJobsClient } from './FieldJobsClient';

/** Settings > Field jobs (workflow spec §5): each branch's switches for the job lifecycle. */
export default async function FieldJobsSettingsPage() {
  const ctx = await requireContext();
  if (ctx.scope.kind !== 'single') return <FieldJobsClient initial={null} storeName="" canEdit={false} />;
  const storeId = ctx.scope.storeId;
  return (
    <FieldJobsClient
      initial={await getJobSettings(storeId)}
      storeName={ctx.stores.find((s) => s.id === storeId)?.name ?? ''}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
