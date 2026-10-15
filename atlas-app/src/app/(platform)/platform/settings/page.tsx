import { notFound } from 'next/navigation';
import { requirePlatformContext } from '@/server/platform-context';
import { getPlatformConfig } from '@/server/platform-admin';
import { requireRootPlatformOwner, RootPlatformOwnerRequiredError } from '@/server/platform-scope';
import { SettingsClient } from './SettingsClient';

export default async function PlatformSettingsPage() {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformConfig.edit')) notFound();

  let isRoot = false;
  try {
    await requireRootPlatformOwner(ctx.user.id);
    isRoot = true;
  } catch (e) {
    if (!(e instanceof RootPlatformOwnerRequiredError)) throw e;
  }

  const config = await getPlatformConfig();

  return <SettingsClient maxResellerDepth={config.maxResellerDepth} canEdit={isRoot} />;
}
