import 'server-only';
import { db } from '../db';

/**
 * The store-access + tenant-lifecycle checks every login surface must apply
 * once credentials are verified - factored out of `app/login/actions.ts`
 * (the web login) so the new `/api/v1/auth/login` route (mobile) enforces
 * the exact same rules instead of a second, hand-copied version that could
 * drift from the original. Pure: no session/cookie/redirect side effects,
 * just "is this user allowed in, and where do they land."
 */
export interface LoginEligible {
  ok: true;
  destination: 'dashboard' | 'platform';
  storeId: string | null;
}
export interface LoginBlocked {
  ok: false;
  error: string;
}

export async function resolveLoginEligibility(userId: string): Promise<LoginEligible | LoginBlocked> {
  // A pure Platform/Reseller user (D045) has memberships instead of store
  // roles - see `User.organizationId`'s schema comment - so either is enough
  // to sign in.
  const hasStore = await db.userStoreRole.findFirst({
    where: { userId },
    select: {
      storeId: true,
      store: {
        select: {
          organization: {
            select: { id: true, lifecycleState: true, scheduledLockAt: true },
          },
        },
      },
    },
  });
  const hasMembership = hasStore ? null : await db.membership.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (!hasStore && !hasMembership) {
    return { ok: false, error: 'Your account has no store access. Contact your administrator.' };
  }

  if (hasStore) {
    const org = hasStore.store.organization;
    let effectiveState = org.lifecycleState;

    // D052 - lazy check, no cron: this project has no background job runner
    // (confirmed - no cron config, no queue), same "manual-only" spirit D048
    // already chose for billing. A tenant nobody attempts to log into stays
    // nominally at its prior state past its lock date until someone tries -
    // acceptable for this phase.
    if (
      org.scheduledLockAt && org.scheduledLockAt <= new Date()
      && effectiveState !== 'SUSPENDED' && effectiveState !== 'TERMINATED'
    ) {
      await db.organization.update({
        where: { id: org.id },
        data: { lifecycleState: 'SUSPENDED', lockedAt: new Date(), lockReason: 'Scheduled lock reached.' },
      });
      effectiveState = 'SUSPENDED';
    }

    // D051 - READ_ONLY (and GRACE_PERIOD, PENDING, ARCHIVED) still sign in;
    // only a full lock blocks login outright. Write-blocking for READ_ONLY
    // happens downstream, in store-scope.ts's scopeForWrite().
    if (effectiveState === 'SUSPENDED' || effectiveState === 'TERMINATED') {
      return { ok: false, error: "Your organisation's access has been suspended. Contact your account manager." };
    }
  }

  return { ok: true, destination: hasStore ? 'dashboard' : 'platform', storeId: hasStore?.storeId ?? null };
}
