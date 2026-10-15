import { Icon } from '@/components/ui/Icon';

/**
 * Renders whenever `AppContext.readOnly` is true (superadmin-roadmap
 * Slice 6, D051) - the tenant's `lifecycleState` is `READ_ONLY` or worse.
 * Every write already refuses itself at `store-scope.ts`'s
 * `scopeForWrite()` regardless of whether this banner renders; this exists
 * purely so the reason isn't a mystery the first time someone's Save
 * button stops working.
 */
export function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-on-tint-danger">
      <Icon name="lock" className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        This account is in <strong className="font-semibold">read-only mode</strong> - you can view
        everything, but nothing can be created, changed or deleted. Contact your account manager.
      </span>
    </div>
  );
}
