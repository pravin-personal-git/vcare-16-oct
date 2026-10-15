/**
 * Where a business user lands in the Vcare app.
 *
 * Decided 24 Sep 2026: the owner / admin gets the full platform inside the
 * app; everyone else gets the employee home built for phone work. "Owner"
 * is not a job title here - it is whoever may change the organisation's
 * settings, the same permission that guards Settings on the website. A
 * manager given that permission sees the owner view, which is correct:
 * they can change everything the owner can.
 */
export type MobileHome = 'owner' | 'employee';

export const OWNER_PERMISSION = 'settings.edit';

export function mobileHomeFor(permissions: Iterable<string>): MobileHome {
  for (const p of permissions) if (p === OWNER_PERMISSION) return 'owner';
  return 'employee';
}
