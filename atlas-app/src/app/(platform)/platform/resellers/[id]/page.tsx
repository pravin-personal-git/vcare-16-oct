import { notFound } from 'next/navigation';
import { requirePlatformContext } from '@/server/platform-context';
import { getResellerDetail } from '@/server/platform-admin';
import { requireRootPlatformOwner, RootPlatformOwnerRequiredError } from '@/server/platform-scope';
import { ResellerDetailClient } from './ResellerDetailClient';

/**
 * Superadmin-roadmap Slice 9 - the reseller equivalent of the tenant detail
 * page, deliberately smaller per the roadmap's own framing ("resellers
 * don't have their own users to credential-manage the same way"): lifecycle
 * only, plus its subtree tenant list. No separate scope check here beyond
 * the permission - lifecycle actions are root-gated (D055), and the root
 * Platform Owner's own scope is always 'platform' (sees every reseller by
 * definition), so a narrower per-account check would be redundant.
 */
export default async function ResellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformReseller.view')) notFound();

  const reseller = await getResellerDetail(id);
  if (!reseller) notFound();

  // Shown only when the caller is actually root - the action re-checks this
  // too, but surfacing it here avoids a "click and watch it fail" dead end
  // for a PLATFORM_ADMIN who holds the permission without being root.
  let isRoot = false;
  if (ctx.permissions.has('platformReseller.suspend')) {
    try {
      await requireRootPlatformOwner(ctx.user.id);
      isRoot = true;
    } catch (e) {
      if (!(e instanceof RootPlatformOwnerRequiredError)) throw e;
    }
  }

  return (
    <ResellerDetailClient
      reseller={{
        ...reseller,
        createdAt: reseller.createdAt.toISOString(),
        scheduledLockAt: reseller.scheduledLockAt?.toISOString() ?? null,
      }}
      canManageLifecycle={isRoot}
    />
  );
}
