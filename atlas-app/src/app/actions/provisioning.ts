'use server';

import { requireContext } from '@/server/context';
import { createBusiness, ProvisioningError, type CreateBusinessInput } from '@/server/provisioning';
import { businessCreationStatus } from '@/server/business-entitlements';

export interface CreateBusinessState {
  ok?: boolean;
  error?: string;
  adminUsername?: string;
}

/**
 * Superadmin-roadmap §1.2 stop-gap, 21 Sep 2026: this used to have no
 * permission check beyond a session, on the reasoning that the result is a
 * brand-new organisation the caller now owns outright, not a change to
 * anyone else's data. That stance is what let a Department Head/Manager
 * see "Create a new business" in their own profile menu - a product
 * decision that was never actually made, just defaulted to "everyone".
 * `business.selfService` (granted to Admin roles only by default) is the
 * same-day fix. Superadmin-roadmap Slice 8, 22 Sep 2026, adds the second,
 * platform-owner-controlled gate on top: `Organization.allowSelfServiceBusinessCreation`.
 * Both must be true - a tenant Admin can still be individually restricted
 * even when the platform allows the tenant the feature in general.
 */
export async function createBusinessAction(input: CreateBusinessInput): Promise<CreateBusinessState> {
  const ctx = await requireContext();
  // 25 Sep 2026: Platform Owner switch + built-in Admin role + plan limit,
  // all in business-entitlements.ts. A Platform Owner inside "Access Tenant"
  // creates tenants from the platform console instead.
  if (ctx.impersonation) return { error: 'Create tenants from the platform console.' };
  const status = await businessCreationStatus(ctx.user.id, ctx.organization.id);
  if (!status.allowed) return { error: status.reason ?? 'Not allowed.' };
  try {
    const result = await createBusiness(ctx.user.id, { ...input, platformAccountId: undefined, fromOrganizationId: ctx.organization.id });
    return { ok: true, adminUsername: result.adminUsername };
  } catch (e) {
    if (e instanceof ProvisioningError) return { error: e.message };
    console.error('[provisioning] createBusiness failed', e);
    return { error: 'Could not create that business. Please try again.' };
  }
}
