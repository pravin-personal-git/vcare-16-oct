/**
 * Screens that live in Settings and nowhere else (Pravin, 5 Oct 2026).
 *
 * They were reachable twice - from a sidebar group and from Settings - and a
 * client could not tell which was "the" place. Now Settings (/settings/hub) is
 * the only door. Three things read this list:
 *
 * - the sidebar (server/context.ts) never shows these, whatever the menu rows
 *   or a role's menu ticks say - so a database that missed the migration, or a
 *   menu rebuilt by hand, still cannot put them back;
 * - `sync-tenant-defaults.ts` never adds a menu row for them;
 * - the settings registry test checks that each one is registered in Settings,
 *   so nothing that leaves the sidebar becomes unreachable.
 *
 * Kept OUT on purpose: /settings/hub (it IS Settings), /settings/employees (a
 * daily register) and /holiday/leave-types (approve buttons and the balance
 * grid make it a work screen). Accounts > Sales Incentive (/employee/incentive)
 * is the incentive report and stays; only its rules (/settings/incentive) move.
 */
const EXTRA_SETTINGS_ROUTES = [
  '/courier', '/hrm/work-schedules', '/hrm/employee-config', '/hierarchy/team-setup',
  '/reports/document-numbers', '/reports/activity-log', '/import', '/departments', '/bank/accounts',
] as const;

const KEPT_IN_MENU = ['/settings/hub', '/settings/employees'];

export function isSettingsOnlyRoute(route: string | null | undefined): boolean {
  if (!route) return false;
  const path = route.split('?')[0];
  if (KEPT_IN_MENU.includes(path)) return false;
  if (path.startsWith('/settings/')) return true;
  return (EXTRA_SETTINGS_ROUTES as readonly string[]).includes(path);
}

export const SETTINGS_ONLY_EXTRA_ROUTES: readonly string[] = EXTRA_SETTINGS_ROUTES;
