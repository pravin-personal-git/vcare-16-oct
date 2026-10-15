import { requireContext } from '@/server/context';
import { SystemConfigClient } from './SystemConfigClient';

export default async function SystemConfigPage() {
  const ctx = await requireContext();
  return <SystemConfigClient canEdit={ctx.permissions.has('settings.edit')} />;
}
