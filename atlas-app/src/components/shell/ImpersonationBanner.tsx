import { Icon } from '@/components/ui/Icon';
import { endTenantAccessAction } from '@/app/actions/impersonation';

/**
 * Renders whenever `AppContext.impersonation` is set - a Platform/Reseller
 * user is inside "Access Tenant" (superadmin-roadmap Slice 5, spec §8),
 * looking at this tenant's data under their own identity, not a specific
 * tenant user's. Persistent (not dismissible) on purpose - the spec's own
 * requirement is that impersonation is never silent, and a banner someone
 * can close is a banner someone stops noticing.
 */
export function ImpersonationBanner({ organizationName }: { organizationName: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-on-tint-warning">
      <Icon name="eye" className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        Viewing <strong className="font-semibold">{organizationName}</strong> as Platform Owner
      </span>
      <form action={endTenantAccessAction}>
        <button
          type="submit"
          className="rounded-md border border-warning/40 bg-card px-2.5 py-1 text-xs font-medium text-warning transition hover:bg-warning/10"
        >
          Return to Platform
        </button>
      </form>
    </div>
  );
}
