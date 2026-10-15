/**
 * The three reading levels, from what a person can do (26 Sep 2026).
 *
 * Used by the handbook (what to show) and by list export (field staff cannot
 * take a copy of the customer list - F1 decision Q1). Lowest first.
 */
export type Level = 'field' | 'office' | 'admin';
export const LEVELS: Level[] = ['field', 'office', 'admin'];

const OFFICE = ['invoice.view', 'accounts.view', 'quotation.view', 'purchase.view', 'attendance.edit', 'hrm.edit'];

export function levelFor(permissions: ReadonlySet<string>): Level {
  if (permissions.has('settings.edit') || permissions.has('users.edit')) return 'admin';
  return OFFICE.some((p) => permissions.has(p)) ? 'office' : 'field';
}

/** May this person export lists? Office and admin only. */
export const canExportLists = (permissions: ReadonlySet<string>) => levelFor(permissions) !== 'field';

/** May this person share a saved view with a whole role? Admin only. */
export const canShareViews = (permissions: ReadonlySet<string>) => levelFor(permissions) === 'admin';
