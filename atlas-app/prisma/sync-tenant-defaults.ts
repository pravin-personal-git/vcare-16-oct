/**
 * Bring an existing database up to date with what the setup scripts now do.
 *
 * `seed.ts` runs only in development and `provision-prod.ts` runs once, when an
 * organisation is created. Anything the product gains afterwards never reaches
 * a database that was set up earlier - so a shipped feature quietly does not
 * work, with nothing in the logs to say why.
 *
 * Eight jobs, all idempotent:
 *
 *   1. PERMISSIONS. Insert any missing permission key and grant every
 *      permission to every role marked `isSystem` (the Admin roles). Never
 *      removes a permission, never touches a non-system role - those carry
 *      restrictions somebody chose on purpose.
 *
 *   2. STALE THEME TOKENS. `Organization.themeTokens` is injected as `:root`
 *      overrides, so it beats the stylesheet. A tenant seeded under an older
 *      palette keeps rendering that palette forever, however much CSS changes.
 *      Tokens matching a known superseded default are cleared; anything a
 *      client deliberately customised is left alone.
 *
 *   3. NEW MENU ITEMS. A screen added to seed.ts reaches nobody who was set up
 *      before it, so the page works and there is no way to reach it. Listed
 *      explicitly, never diffed - see `NEW_MENUS`.
 *
 *   4. CHART OF ACCOUNTS. Every organisation needs the standard accounts the
 *      general ledger posts to by code. Missing accounts are added; nothing
 *      that already exists is touched, so a tenant's own renamed or added
 *      accounts survive every run. See `lib/chart-of-accounts.ts`.
 *
 *   5. GOVERNMENT HOLIDAYS. A starter set of fixed-date national holidays on
 *      the global `GovernmentHoliday` master list, for stores to toggle on.
 *      Global, not per-organisation - the same list for every tenant.
 *
 *   6. ADMIN DESIGNATION. The Admin role ships with no `designationCode`/
 *      `level` (see `seed.ts`), so Team Setup's designation dropdown - which
 *      only offers roles that HAVE one - has nothing to show for whoever
 *      reports to nobody, the org's actual owner. Backfilled to "ADMIN"/
 *      level 1 only where still null; an org that has already customised it
 *      (to "Owner", "Founder", whatever fits) via Settings > Roles keeps
 *      that choice untouched.
 *
 *   7. HRM MENU REORDER. The fifteen-item HRM group had every People screen
 *      flattened into one list, in the order each was built rather than the
 *      order anyone would actually use it - confirmed messy against a real
 *      atlas-hrns comparison, 19 Sep 2026. Split into HRM (the five daily
 *      screens: Dashboard, Payroll, Hierarchy Flow, Recruitment, Onboarding,
 *      in that order) and a new HRM Configurations group holding the rest
 *      (Offboarding, Employee Mgmt, Salary Structure, Contracts, Attendance
 *      Settings/Devices/Permissions, Leave Types, Team Setup, Insurance and
 *      Policy). Runs once - detects its own prior run by checking whether
 *      Employee Mgmt already lives under HRM Configurations, and does
 *      nothing on every run after the first.
 *
 *   8. HRM ACCORDION (Phase 0, 20 Sep 2026). Supersedes job 7's split with the
 *      real 14-row order the roadmap's §4.1 specifies - see
 *      `restructureHrmAccordion` for the full mapping. Runs once, detected by
 *      whether "HRM" already has an "Employee" child.
 *

 * Development:  npm run db:defaults
 * Production:   npm run db:defaults:prod   (after the deploy lands)
 */
import { PrismaClient, type PlatformRoleScopeType } from '@prisma/client';
import { STANDARD_CHART_OF_ACCOUNTS } from '../src/lib/chart-of-accounts';
import { presetForRole } from '../src/lib/app-access';
import { SPLIT_MODULE_GRANTS, splitGrantsFor } from '../src/lib/role-modules';
import { isSettingsOnlyRoute } from '../src/lib/settings-only-routes';
import { PERMISSION_CATALOGUE } from '../src/lib/permission-catalogue';

const db = new PrismaClient();

const PERMISSIONS = [...PERMISSION_CATALOGUE];

/**
 * Palettes this product has shipped and moved on from. A tenant still holding
 * one of these is holding it by accident, not by choice.
 */
const SUPERSEDED_TOKENS: Record<string, string>[] = [
  // The original orange/navy default, replaced 2026-08-13.
  { '--brand-primary': '24 78% 57%', '--brand-accent': '220 40% 16%' },
  // The sky-blue default, replaced by Atlas blue in the UI refresh, 4 Oct 2026.
  { '--brand-primary': '197 100% 44%', '--brand-navy': '213 94% 19%', '--brand-accent': '12 100% 67%' },
];

function isSuperseded(tokens: unknown): boolean {
  if (!tokens || typeof tokens !== 'object') return false;
  const t = tokens as Record<string, unknown>;
  const keys = Object.keys(t);
  if (keys.length === 0) return false;

  return SUPERSEDED_TOKENS.some((old) =>
    // Every key the tenant holds must match a superseded default exactly. One
    // hand-tuned value and we leave the whole thing alone.
    keys.every((k) => old[k] !== undefined && old[k] === t[k]),
  );
}

async function syncThemeTokens() {
  const orgs = await db.organization.findMany({
    select: { id: true, name: true, themeTokens: true },
  });

  let cleared = 0;
  for (const o of orgs) {
    if (!isSuperseded(o.themeTokens)) continue;
    await db.organization.update({ where: { id: o.id }, data: { themeTokens: {} } });
    console.log(`  cleared a superseded palette on "${o.name}"`);
    cleared += 1;
  }

  const customised = orgs.filter(
    (o) => o.themeTokens && Object.keys(o.themeTokens as object).length > 0
      && !isSuperseded(o.themeTokens),
  ).length;

  console.log(
    `Theme: ${orgs.length} organisation(s). Cleared: ${cleared}. `
    + `Left customised: ${customised}.`,
  );
}

/**
 * Menu items added since a tenant was set up.
 *
 * A new screen is added to `MENU_TREE` in seed.ts, which runs once in
 * development and never again anywhere. Every existing database therefore has
 * a working page with no way to reach it - the exact failure this file was
 * written for, and one it did not cover until Receipts shipped and was
 * invisible.
 *
 * Listed explicitly rather than diffed against seed.ts. A diff would also
 * "restore" menu items a client had deliberately removed, and quietly putting
 * back something somebody chose to hide is worse than a missing link.
 */
const NEW_MENUS: {
  parent: string; label: string; route: string; icon: string; before?: string;
}[] = [
  { parent: 'Accounts', label: 'Receipts', route: '/receipts', icon: 'credit-card', before: 'GST Computation' },
  // Sales Return already has a menu row from the original seed - it pointed at
  // a placeholder screen and now points at a real one, so nothing to add there.
  // Credit Notes is new, and sits immediately after it because the two are read
  // together: a return with no credit note is the thing you are looking for.
  { parent: 'Accounts', label: 'Credit Notes', route: '/credit-notes', icon: 'receipt', before: 'Sales Incentive' },
  // Under Sales, not Reports - there is no Reports group, and a call log is a
  // sales-activity screen that sits naturally beside Leads and Customers.
  /*
    The sales side of the calls screen (8 Oct 2026).

    This said 'Call Logs' -> '/call-logs' and the 8 Oct migration renamed it
    to 'Sales Team Calls' -> '/call-logs?team=sales'. Left alone, the very
    next deploy found no row at the old route, decided the item was missing
    and added a SECOND one - which is precisely how Pravin ended up with the
    service calls screen in two places. A rename in SQL belongs here too.
  */
  { parent: 'Sales', label: 'Sales Team Calls', route: '/call-logs?team=sales', icon: 'phone' },
  { parent: 'System Settings', label: 'Phones', route: '/settings/call-devices', icon: 'phone' },
  // Under Attendance, which already exists as a group with a placeholder inside.
  // Shift Log is the real screen; the placeholder is left alone rather than
  // deleted, because removing a menu row somebody may have permissions on is a
  // bigger change than adding one.
  // The grid before the shift log. The month view is what somebody opens
  // Attendance to see; the per-shift detail is where they go afterwards when a
  // particular cell looks wrong.
  // MAALIK OS week 2, 25 Sep 2026 - the live board, first in the group.
  { parent: 'Attendance', label: 'Team Today', route: '/attendance/team-today', icon: 'users', before: 'Monthly Grid' },
  { parent: 'Attendance', label: 'Monthly Grid', route: '/attendance/grid', icon: 'calendar' },
  { parent: 'Attendance', label: 'Shift Log', route: '/attendance/shifts', icon: 'clock' },
  // Phase 2 of the HRM-in-Atlas roadmap, eighth slice, 20 Sep 2026 (§4.3) -
  // Attendance's remaining extra screens. All read from the same
  // AttendanceDay/AttendanceSession/attendanceMonth() sources the grid
  // already uses - see attendance-reports.ts.
  { parent: 'Attendance', label: 'Daily Work Status', route: '/attendance/daily-status', icon: 'check-circle' },
  { parent: 'Attendance', label: 'Check-in/Check-out Log', route: '/attendance/checkin-log', icon: 'map-pin' },
  { parent: 'Attendance', label: 'Late Arrival & Early Departure', route: '/attendance/late-early', icon: 'alert-triangle' },
  { parent: 'Attendance', label: 'Monthly Summary', route: '/attendance/monthly-summary', icon: 'bar-chart' },
  // Daily staff checklist, 25 Sep 2026 - Vcare's old KPI screen, generalised.
  { parent: 'Attendance', label: 'Daily Checklist', route: '/attendance/checklist', icon: 'check-circle' },
  {
    parent: 'HRM', label: 'Attendance Devices', route: '/settings/attendance/devices', icon: 'settings',
    before: 'Hierarchy Flow',
  },
  {
    parent: 'HRM', label: 'Attendance Permissions', route: '/settings/attendance/permissions', icon: 'lock',
    before: 'Hierarchy Flow',
  },
  // Where each employee may clock in from the phone - MAALIK OS week 2.
  {
    parent: 'HRM', label: 'Clock-in Rules', route: '/settings/attendance/clock-in-rules', icon: 'map-pin',
    before: 'Hierarchy Flow',
  },
  // Phase C item 9 of the admin-settings deep audit - after Hierarchy Flow,
  // since a designation/manager/branch assignment is what the reporting-line
  // editor on that screen feeds into.
  { parent: 'HRM', label: 'Team Setup', route: '/hierarchy/team-setup', icon: 'user-plus' },
  // Phase 1 of the payroll/HRMS-in-Atlas roadmap, 19 Sep 2026 - the first
  // real payroll screen. Sits right after Salary Structure, the flat
  // predecessor this supersedes.
  {
    parent: 'HRM', label: 'Payroll Dashboard', route: '/hrm/payroll', icon: 'receipt',
    before: 'Attendance Settings',
  },
  {
    parent: 'HRM', label: 'Contracts', route: '/hrm/payroll/contracts', icon: 'file-text',
    before: 'Attendance Settings',
  },
  // Same roadmap, next module - internal employee ticketing. Under Common
  // Hub, right after Asset Management: both are "things any employee opens
  // to ask the business for something", and Assets already lives there.
  { parent: 'Common Hub', label: 'Helpdesk', route: '/helpdesk', icon: 'alert-circle', before: 'Terms & Policy' },
  /*
    Messages (14 Oct 2026). The inbox has been real since 18 September and
    was reachable ONLY from the header rail's envelope icon - so when that
    icon was removed it would have had no door at all. It is the one page in
    that rail the sidebar had never listed.
  */
  { parent: 'Common Hub', label: 'Messages', route: '/messages', icon: 'mail' },
  // Third HRMS module - the HRM group's own landing page. It's had six
  // children and no page of its own since Contracts shipped; this is the
  // command centre that ties payroll/approvals/assets/helpdesk together.
  { parent: 'HRM', label: 'HRM Dashboard', route: '/hrm', icon: 'users', before: 'Employee Mgmt' },
  // Fourth, fifth and sixth (final) HRMS modules - the Recruitment /
  // Onboarding / Offboarding trio, all built together since they share the
  // new EmployeeProfile model and (for Onboarding/Offboarding) the same
  // checklist engine.
  { parent: 'HRM', label: 'Recruitment', route: '/hrm/recruitment', icon: 'user-plus', before: 'Employee Mgmt' },
  { parent: 'HRM', label: 'Onboarding', route: '/hrm/onboarding', icon: 'user-plus', before: 'Employee Mgmt' },
  { parent: 'HRM', label: 'Offboarding', route: '/hrm/offboarding', icon: 'user', before: 'Employee Mgmt' },
  // Phase D item 15b of the admin-settings deep audit - `Account` rows
  // existed and were posted to since the GL was built, but nothing let an
  // admin browse or extend them; only the seed script ever wrote a row.
  {
    parent: 'Reference Data', label: 'Chart of Accounts', route: '/settings/chart-of-accounts',
    icon: 'sliders', before: 'Bank Account',
  },
  // Purchase. The group already exists with a placeholder "Purchase Orders"
  // inside it; these are the real screens. The placeholder is left alone rather
  // than removed - deleting a menu row somebody may hold permissions on is a
  // bigger change than adding one.
  { parent: 'Purchase', label: 'Purchase Bills', route: '/purchase/bills', icon: 'receipt' },
  { parent: 'Purchase', label: 'Payables', route: '/purchase/payables', icon: 'credit-card' },
  // The operating manual. First item in Common Hub, because the person who
  // needs it most is the one who has just been shown the sidebar for the first
  // time and does not yet know what any of it means.
  {
    parent: 'Common Hub', label: 'How Atlas Works', route: '/handbook', icon: 'file-text',
    before: 'Notices & Announcements',
  },
  // First item under Financial Reports, because it is the one somebody arrives
  // looking for - "get me last quarter for the accountant" - and it leads to
  // every other report rather than being one of them.
  {
    parent: 'Financial Reports', label: 'Reports & Downloads',
    route: '/reports/downloads', icon: 'download', before: 'Profit & Loss',
  },
  { parent: 'Inventory', label: 'Stock', route: '/reports/product-stock', icon: 'package' },
  // Under System Settings, not Financial Reports. These are figures somebody
  // types once and rarely revisits - putting them next to the balance sheet
  // would invite editing them whenever the sheet looked wrong, which is exactly
  // the wrong instinct.
  {
    parent: 'System Settings', label: 'Opening Balances',
    route: '/settings/opening-balance', icon: 'credit-card',
  },
  // Under HRM, right after Employee Mgmt - the light Payroll screen.
  { parent: 'HRM', label: 'Salary Structure', route: '/hrm/salary', icon: 'receipt', before: 'Attendance Settings' },
  // Under Users & Roles, first - creating a role is the thing everything else
  // in that group assumes already happened.
  { parent: 'Users & Roles', label: 'Roles', route: '/settings/roles', icon: 'user-plus', before: 'User Store Roles' },
  // Customer Service is a brand new top-level group - see
  // syncNewMenuGroups below, which creates the parent itself before this
  // loop runs, so these four find it exactly like any other child would.
  { parent: 'Customer Service', label: 'Complaints Tracker', route: '/services/complaints', icon: 'alert-circle' },
  // Health check SVC-1 (25 Sep 2026): the visit scheduler was called "Service
  // Calls" - the same words as the service team's phone calls. It is now the
  // Visit Scheduler, and the calls screen lives here too (restructureServicesMenu).
  // The Complaint Tracker entry is retired: each complaint has its own page.
  { parent: 'Customer Service', label: 'Visit Scheduler', route: '/services/visits', icon: 'calendar' },
  { parent: 'Customer Service', label: 'Repair challans (history)', route: '/services/repairs', icon: 'truck' },
  /*
    The calls screen, at the address it actually lives at.

    This row used to say `/service`, which is not a calls screen and never
    was - the 7 Oct migration pointed it at `/call-logs?team=service`. Because
    this default still named the dead route, every deploy decided the row was
    missing and made a second one. ONE home for calls, which is what Pravin
    asked for; the Sales side is `?team=sales` and lives under Sales.
  */
  { parent: 'Customer Service', label: 'Service Team Calls', route: '/call-logs?team=service', icon: 'phone' },
  // Phase A item 2 of the admin-settings deep audit's build order - a
  // payroll-blocking gap. Sits right after Attendance Settings, before
  // Hierarchy Flow, matching seed.ts and provision-prod.ts.
  { parent: 'HRM', label: 'Leave Types & Allocation', route: '/holiday/leave-types', icon: 'calendar', before: 'Hierarchy Flow' },
  // Phase 2 of the HRM-in-Atlas roadmap, 19 Sep 2026 (§4.1a) - a real
  // per-branch summary, distinct from the HRM Dashboard label above (which
  // is actually the Homescreen/quick-nav hub, not a data summary). Sits
  // right after it since the two are opened back to back.
  { parent: 'HRM', label: 'HR Summary', route: '/hrm/dashboard', icon: 'bar-chart', before: 'Payroll Dashboard' },
  // Phase 2 of the HRM-in-Atlas roadmap, second slice, 19 Sep 2026 (§4.2) -
  // the DISCIPLINE half of "Policies & Discipline". The POLICIES half stays
  // exactly where it already is, Common Hub's "Terms & Policy". Under HRM
  // Configurations, not HRM - set up occasionally, not a daily-use screen,
  // same reasoning as Employee Mgmt right next to it.
  {
    parent: 'HRM Configurations', label: 'Policies & Discipline', route: '/hrm/discipline',
    icon: 'alert-triangle', before: 'Salary Structure',
  },
  // Phase 2 of the HRM-in-Atlas roadmap, fifth slice, 20 Sep 2026 (§4.2) -
  // shift/work-type configuration and employee assignment. Deliberately
  // NOT wired into attendance classification yet - see the schema comment
  // on `EmployeeShift`.
  {
    parent: 'HRM Configurations', label: 'Work Schedules', route: '/hrm/work-schedules',
    icon: 'clock', before: 'Salary Structure',
  },
  // Phase 2 of the HRM-in-Atlas roadmap, sixth slice, 20 Sep 2026 (§4.2) -
  // Employee Configuration: employee types and tags, purely descriptive,
  // deliberately separate from the employmentType enum payroll conditions
  // already depend on - see the schema comment on
  // EmployeeProfile.employeeTypeTagId.
  {
    parent: 'HRM Configurations', label: 'Employee Configuration', route: '/hrm/employee-config',
    icon: 'tag', before: 'Salary Structure',
  },
  // Phase 3 of the HRM-in-Atlas roadmap, 20 Sep 2026 (§4.5) - the first of
  // three Payroll UIs onto existing models. Parented to 'HRM' like every
  // other NEW_MENUS entry (syncMenus only appends to an EXISTING top-level
  // group) - restructureHrmAccordion below re-parents it under the Payroll
  // row on the same run, same as it does for the pre-existing Payroll items.
  { parent: 'HRM', label: 'Loans & Advances', route: '/hrm/loans', icon: 'receipt' },
  // Phase 3, second slice, 20 Sep 2026 (§4.5) - LeaveEncashment/
  // ReimbursementClaim existed in schema, hierarchy-routed, but "not yet
  // raised from anywhere" per the payroll-schema commit's own notes.
  { parent: 'HRM', label: 'Encashments & Reimbursements', route: '/hrm/payroll/claims', icon: 'receipt' },
  // F-03 (6 Oct 2026): fuel / travel money from km, raised as travel claims.
  { parent: 'HRM', label: 'Travel Allowance', route: '/hrm/payroll/travel', icon: 'map-pin', before: 'Income Tax' },
  // Phase 3, third and final Payroll slice, 20 Sep 2026 (§4.5) -
  // IncomeTaxDeclaration existed in schema, unused; this is what finally
  // reads it, closing calculateMonthlyTDS's flagged old-regime gap.
  { parent: 'HRM', label: 'Income Tax', route: '/hrm/payroll/income-tax', icon: 'file-text' },
  // Phase 3, Recruitment slice, 20 Sep 2026 (§4.6) - land as flat HRM
  // children first, same as every other NEW_MENUS entry; convertRecruitmentIntoAccordion
  // below moves them under the Recruitment row once it exists.
  { parent: 'HRM', label: 'Interviews', route: '/hrm/recruitment/interviews', icon: 'calendar' },
  { parent: 'HRM', label: 'Talent Pool', route: '/hrm/recruitment/talent-pool', icon: 'users' },
  // Phase 5, Helpdesk FAQs slice, 20 Sep 2026 (§4.9) - lands flat under HRM
  // first; convertHelpdeskIntoAccordion below moves it under the Helpdesk
  // row once it exists, same pattern as Recruitment's Interviews/Talent Pool.
  { parent: 'HRM', label: 'FAQs', route: '/helpdesk/faqs', icon: 'info' },
  // Platform-ownership phase, Slice 2, 21 Sep 2026 (D046) - makes the new
  // LegalEntity concept visible. Right after Org Profile, since a legal
  // entity is a property of the organisation the same way branding is.
  { parent: 'System Settings', label: 'Legal Entities', route: '/settings/legal-entities', icon: 'building', before: 'Import Data' },
  // 26 Sep 2026 - owner-defined fields on customers, leads and products, next to
  // Parameters (the masters) since both shape what the forms ask for.
  { parent: 'Reference Data', label: 'Custom Fields', route: '/settings/custom-fields', icon: 'sliders' },
  // 27 Sep 2026 - NOTIFICATIONS-APPROVALS-SPEC.md: everyone's own inbox, and the owner's rules.
  { parent: 'Common Hub', label: 'My Reminders & Requests', route: '/my/reminders', icon: 'clock' },
  { parent: 'System Settings', label: 'Approval Rules', route: '/settings/approval-rules', icon: 'check-circle' },
  // 28 Sep 2026 - field-job engine (workflow spec): the board of open jobs, and each branch's job switches.
  { parent: 'Customer Service', label: 'Jobs Dashboard', route: '/services/board', icon: 'columns', before: 'Complaints Tracker' },
  { parent: 'System Settings', label: 'Field jobs', route: '/settings/field-jobs', icon: 'map-pin' },
  { parent: 'Inventory', label: 'Parts counter', route: '/goods-dispatch/job-parts', icon: 'truck' },
  // 28 Sep 2026: old and faulty units that are not sellable, and their value.
  { parent: 'Inventory', label: 'Dead stock & scrap', route: '/goods-dispatch/dead-stock', icon: 'trash' },
];

/**
 * `syncMenus` above only ever appends a CHILD to an EXISTING top-level group -
 * by design, so a typo in `parent` fails loudly (a warning, not a silently
 * created duplicate group) instead of scattering near-duplicate groups across
 * a database. A genuinely new top-level group is rare enough that it gets its
 * own explicit list here instead.
 */
/**
 * Groups this sync creates when they are missing.
 *
 * READ THIS BEFORE RENAMING A MENU GROUP IN SQL. This list ran against the
 * 7 Oct migration and won, once per deploy: that migration renamed
 * 'Services & Complaints' to 'Customer Service', this list found no group by
 * the old name, concluded it was missing, and built a fresh one - with the
 * one child whose route the migration had also changed, so the default could
 * no longer be matched to an existing row. Pravin's sidebar ended up with
 * both groups and the calls screen in two places.
 *
 * A rename in SQL has to come here too, or the next deploy undoes it.
 */
const NEW_TOP_LEVEL_GROUPS: { label: string; icon: string; before?: string }[] = [
  { label: 'Customer Service', icon: 'alert-circle', before: 'Task Manager' },
];

async function syncNewMenuGroups() {
  let added = 0;
  for (const group of NEW_TOP_LEVEL_GROUPS) {
    if (await db.menu.findFirst({ where: { label: group.label, parentId: null } })) continue;

    const anchor = group.before
      ? await db.menu.findFirst({ where: { parentId: null, label: group.before } })
      : null;
    const last = await db.menu.findFirst({
      where: { parentId: null }, orderBy: { sort: 'desc' }, select: { sort: true },
    });
    const sort = anchor ? anchor.sort - 1 : (last?.sort ?? 0) + 1;

    const menu = await db.menu.create({
      data: { label: group.label, route: null, icon: group.icon, sort },
    });

    const stores = await db.store.findMany({ select: { id: true } });
    await db.storeMenuConfig.createMany({
      data: stores.map((s) => ({ storeId: s.id, menuId: menu.id, isEnabled: true })),
      skipDuplicates: true,
    });
    const roles = await db.role.findMany({ select: { id: true, storeId: true } });
    await db.roleMenuConfig.createMany({
      data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: menu.id, isVisible: true })),
      skipDuplicates: true,
    });

    added += 1;
    console.log(`Menu group added: ${group.label} (${stores.length} stores, ${roles.length} roles)`);
  }
  if (added === 0) console.log('Menu groups: nothing to add.');
}

/**
 * Services & Complaints tidy-up (health check SVC-1, 25 Sep 2026). Runs before
 * syncMenus so the renamed rows are found by their new routes there.
 * Idempotent: each step checks the current state first.
 */
async function restructureServicesMenu() {
  /*
    Either name. The group was renamed to 'Customer Service' on 7 Oct, and
    this lookup - still on the old label - quietly stopped doing anything on
    a renamed tenant while the defaults above went on rebuilding the old
    group underneath it.
  */
  const group = await db.menu.findFirst({
    where: { parentId: null, label: { in: ['Customer Service', 'Services & Complaints'] } },
  });
  if (!group) { console.log('Services menu: group not found, skipping.'); return; }

  const scheduler = await db.menu.findFirst({ where: { route: '/services/calls' } });
  if (scheduler) {
    await db.menu.update({ where: { id: scheduler.id }, data: { route: '/services/visits', label: 'Visit Scheduler' } });
    console.log('Services menu: "Service Calls" renamed to "Visit Scheduler".');
  }

  /*
    `/service` is the pre-7-Oct address of the calls screen. Where the real
    row (`/call-logs?team=service`) exists, the old one is a second "Service
    Team Calls" and is deleted - this used to MOVE it under the group, which
    is how the live sidebar ended up listing it twice (9 Oct 2026). Where the
    real row does not exist yet, the old one is repointed and becomes it.
  */
  const teamCalls = await db.menu.findFirst({ where: { route: '/service' } });
  if (teamCalls) {
    const real = await db.menu.findFirst({ where: { route: '/call-logs?team=service' } });
    if (real) {
      // Its config rows go with it (onDelete: Cascade).
      await db.menu.delete({ where: { id: teamCalls.id } });
      console.log('Services menu: duplicate "Service Team Calls" (/service) removed.');
    } else {
      const last = await db.menu.findFirst({ where: { parentId: group.id }, orderBy: { sort: 'desc' }, select: { sort: true } });
      await db.menu.update({
        where: { id: teamCalls.id },
        data: {
          parentId: group.id, label: 'Service Team Calls', route: '/call-logs?team=service',
          icon: 'phone', sort: (last?.sort ?? 0) + 1,
        },
      });
      console.log(`Services menu: service team calls moved under ${group.label}.`);
    }
  }

  // The phones screen was named after the retired Call Sync app (CALL-3).
  const phones = await db.menu.findFirst({ where: { route: '/settings/call-devices', label: 'Call Sync Devices' } });
  if (phones) {
    await db.menu.update({ where: { id: phones.id }, data: { label: 'Phones' } });
    console.log('Menu: "Call Sync Devices" renamed to "Phones".');
  }

  const tracker = await db.menu.findFirst({ where: { route: '/services/tracker' } });
  if (tracker) {
    // Its config rows go with it (onDelete: Cascade).
    await db.menu.delete({ where: { id: tracker.id } });
    console.log('Services menu: "Complaint Tracker" entry retired - complaints open on their own page.');
  }
}

/**
 * The HRM "Leave" link opens leave-type SETUP, not "apply for leave" - a
 * manager clicking it hit a no-access page thinking it was the leave form
 * (27 Sep 2026). Name it for what it is; applying lives in My Desk.
 */
async function renameLeaveSetup() {
  const rows = await db.menu.findMany({ where: { route: '/holiday/leave-types', label: { in: ['Leave', 'Leave Types'] } } });
  for (const r of rows) await db.menu.update({ where: { id: r.id }, data: { label: 'Leave Types & Allocation' } });
  if (rows.length) console.log(`Menu: ${rows.length} leave-setup link(s) renamed to "Leave Types & Allocation".`);
}

/**
 * My Desk (27 Sep 2026, streamline S2): the personal page where anyone raises
 * a request. It started as "My Reminders & Requests" under Common Hub, where
 * nobody looks; it is now a top-level item right after Dashboard. Runs after
 * syncMenus has created the row. Idempotent.
 */
async function promoteMyDesk() {
  const row = await db.menu.findFirst({ where: { route: '/my/reminders' } });
  if (!row || (row.parentId === null && row.label === 'My Desk')) return;
  const dashboard = await db.menu.findFirst({ where: { parentId: null, route: '/dashboard' } });
  const at = (dashboard?.sort ?? 0) + 1;
  await db.menu.updateMany({ where: { parentId: null, sort: { gte: at }, NOT: { id: row.id } }, data: { sort: { increment: 1 } } });
  await db.menu.update({ where: { id: row.id }, data: { parentId: null, label: 'My Desk', icon: 'send', sort: at } });
  console.log('Menu: "My Reminders & Requests" is now "My Desk", right after Dashboard.');
}

/**
 * One menu row per dashboard, under the top-level Dashboard row (B1, 11 Oct
 * 2026). The Dashboards section of the sidebar used to decide from
 * permissions alone, so nothing in Settings › Role & User Menu could take a
 * dashboard away from a role. Now each one has a row there; unticking it
 * hides that dashboard (lib/menu-gate `menuHidesDash`), unticking Dashboard
 * hides them all. My day has no row - it is everyone's own.
 *
 * Shown for every branch and role when created, so nobody loses a dashboard
 * on the deploy that adds them. The sidebar draws these from its own
 * Dashboards section, never as a second group. Idempotent by route.
 */
const DASHBOARD_ROWS = [
  { k: 'business', label: 'Business dashboard' },
  { k: 'sales', label: 'Sales dashboard' },
  { k: 'service', label: 'Service dashboard' },
  { k: 'stock', label: 'Stock dashboard' },
  { k: 'accounts', label: 'Accounts dashboard' },
  { k: 'people', label: 'People dashboard' },
];

async function syncDashboardRows() {
  const parent = await db.menu.findFirst({ where: { parentId: null, route: '/dashboard', deletedAt: null } });
  if (!parent) { console.log('Dashboard rows: no Dashboard menu row, skipping.'); return; }
  let added = 0;
  for (const [i, d] of DASHBOARD_ROWS.entries()) {
    const route = `/dashboard?tab=${d.k}`;
    if (await db.menu.findFirst({ where: { route } })) continue;
    const m = await db.menu.create({ data: { parentId: parent.id, label: d.label, route, icon: 'bar-chart', sort: i } });
    const stores = await db.store.findMany({ select: { id: true } });
    await db.storeMenuConfig.createMany({ data: stores.map((st) => ({ storeId: st.id, menuId: m.id, isEnabled: true })), skipDuplicates: true });
    const roles = await db.role.findMany({ select: { id: true, storeId: true } });
    await db.roleMenuConfig.createMany({ data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: m.id, isVisible: true })), skipDuplicates: true });
    added += 1;
  }
  console.log(added ? `Dashboard rows: ${added} added under Dashboard.` : 'Dashboard rows: nothing to add.');
}

/**
 * Attendance stopped being a top-level group when HRM became an accordion
 * (restructureHrmAccordion), so syncMenus - which looks for a top-level
 * "Attendance" - silently skipped screens added later: Team Today and the
 * Daily Checklist (found 26 Sep 2026). Add any that are missing under
 * HRM > Attendance instead.
 */
async function syncHrmAttendanceLeaves() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  const row = hrm && await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Attendance' } });
  if (!row) return;
  const leaves = [
    { label: 'Team Today', route: '/attendance/team-today', icon: 'users' },
    { label: 'Daily Checklist', route: '/attendance/checklist', icon: 'check-circle' },
  ];
  for (const l of leaves) {
    if (await db.menu.findFirst({ where: { route: l.route } })) continue;
    const last = await db.menu.findFirst({ where: { parentId: row.id }, orderBy: { sort: 'desc' }, select: { sort: true } });
    await ensureLeaf(row.id, l.label, l.route, l.icon, (last?.sort ?? 0) + 1);
    console.log(`Menu added: HRM > Attendance > ${l.label}`);
  }
}

/**
 * FAQ / Help and "How Atlas Works" became one page on 26 Sep 2026 (/handbook,
 * built for the reader's level). The top-level FAQ row is pointed at it and
 * renamed; any second /handbook row (the old Common Hub entry) is removed so the
 * sidebar has one way in. Config rows go with it (onDelete: Cascade).
 */
async function mergeHelpMenu() {
  const top = await db.menu.findFirst({ where: { parentId: null, route: { in: ['/faq', '/handbook'] } } });
  if (!top) return;
  if (top.route !== '/handbook' || top.label !== 'Help & Handbook') {
    await db.menu.update({ where: { id: top.id }, data: { route: '/handbook', label: 'Help & Handbook' } });
    console.log('Menu: "FAQ / Help" is now "Help & Handbook".');
  }
  const extra = await db.menu.deleteMany({ where: { route: '/handbook', id: { not: top.id } } });
  if (extra.count) console.log('Menu: duplicate "How Atlas Works" entry removed.');
}

/**
 * The SOP guidebook, under Common Hub.
 *
 * It was a TOP-LEVEL item from 6 Oct 2026, for one reason: the header rail's
 * help icon pointed at it, so it needed to exist somewhere. On 14 Oct that
 * icon was removed along with three others, and the guidebook moved in with
 * the rest of the reading material - the handbook, the notices, the
 * policies. Visible in every branch to every role: it is training material,
 * and the page itself decides what each reader may see.
 *
 * Idempotent, and guarded on the ROUTE, so a tenant that already has the row
 * - wherever it sits - is left alone.
 */
async function addSopGuideMenu() {
  if (await db.menu.findFirst({ where: { route: '/handbook/sop' } })) return;
  const hub = await db.menu.findFirst({ where: { parentId: null, label: 'Common Hub' } });
  if (!hub) return;
  const last = await db.menu.findFirst({ where: { parentId: hub.id }, orderBy: { sort: 'desc' }, select: { sort: true } });
  const m = await db.menu.create({ data: { parentId: hub.id, label: 'SOP Guidebook', route: '/handbook/sop', icon: 'file-text', sort: (last?.sort ?? 0) + 1 } });
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({ data: stores.map((st) => ({ storeId: st.id, menuId: m.id, isEnabled: true })), skipDuplicates: true });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({ data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: m.id, isVisible: true })), skipDuplicates: true });
  console.log('Menu added: SOP Guidebook, under Common Hub.');
}

/**
 * Help & Handbook leaves the sidebar (6 Oct 2026, Pravin: two help entries side
 * by side confused people). The SOP Guidebook takes its place; the Handbook
 * page stays at /handbook, opened from the guidebook's own "Handbook" button
 * (it holds the per-screen FAQ and the old-app map). Its role and branch
 * settings go with the row (onDelete: Cascade). Idempotent.
 */
async function retireHelpMenu() {
  const help = await db.menu.findFirst({ where: { parentId: null, route: '/handbook' } });
  const sop = await db.menu.findFirst({ where: { route: '/handbook/sop' } });
  if (!help || !sop) return;
  /*
    It used to move the guidebook to the top level here, taking the retired
    Help row's place. It must NOT any more: since 14 Oct 2026 the guidebook
    lives under Common Hub, and this would have yanked it back out on the
    first deploy for any tenant that still had a top-level Help row.

    It never fired on Vcare - their /handbook sits inside Common Hub, so
    `help` was already null - but a tenant seeded before that would have hit
    it, and the symptom (an item that walks back to the top after every
    deploy) is exactly the kind nobody can explain.
  */
  await db.menu.delete({ where: { id: help.id } });
  console.log('Menu: the old top-level Help & Handbook row removed.');
}

/**
 * The standard GST slabs in every branch's GST Rates master (26 Sep 2026).
 * The rate dropdown on document lines was a hard-coded 0/5/12/18/28 while the
 * master stayed empty - the Vcare meeting found the settings page blank next to
 * a working dropdown. Now the dropdown reads the master, so every branch with no
 * rates gets the five slabs once. A branch that already has its own list is left
 * alone; nothing is overwritten or removed.
 */
/**
 * Starter Terms & Conditions templates (26 Sep 2026). The forms used to carry
 * this text hard-coded - three choices on quotations, one fixed text each on
 * orders and invoices. Now they read the Terms & Conditions master, so a
 * branch with no templates gets exactly that text as templates, with the same
 * one filled in by default as before. A branch with any template is left alone.
 */
const STARTER_TERMS: { name: string; body: string; defaultFor: string[] }[] = [
  {
    name: 'Standard - 90/10 payment',
    body: '1. Products carry warranty as per company policy.\n2. Fitting accessories and cable charged as actual.\n3. 90% advance against delivery, 10% after installation.',
    defaultFor: ['quotation'],
  },
  {
    name: 'Advance payment',
    body: '1. Payment 100% in advance.\n2. Delivery within 7 working days of confirmed order.\n3. Warranty as per manufacturer terms.',
    defaultFor: [],
  },
  {
    name: 'Credit - 30 days',
    body: '1. Payment within 30 days of invoice.\n2. Goods once sold will not be taken back.\n3. Subject to local jurisdiction.',
    defaultFor: [],
  },
  {
    name: 'Sales order - standard',
    body: '1. Delivery as per the agreed schedule.\n2. Goods remain our property until paid for in full.\n3. Shortages must be reported within 48 hours of delivery.',
    defaultFor: ['sales_order'],
  },
  {
    name: 'Invoice - standard',
    body: '1. Goods once sold will not be taken back.\n2. Interest at 18% per annum is charged on overdue amounts.\n3. Subject to local jurisdiction.',
    defaultFor: ['invoice'],
  },
];

async function seedTermsTemplates() {
  const stores = await db.store.findMany({ select: { id: true } });
  let seeded = 0;
  for (const st of stores) {
    if (await db.tncTemplate.count({ where: { storeId: st.id } })) continue;
    await db.tncTemplate.createMany({ data: STARTER_TERMS.map((t) => ({ storeId: st.id, ...t })), skipDuplicates: true });
    seeded += 1;
  }
  if (seeded) console.log(`Terms templates: starter set added to ${seeded} branch(es).`);
}

/**
 * Phone app access presets (26 Sep 2026, PHONE-APP-ACCESS-SPEC.md, decided:
 * "sensible presets by role name"). Every role without a Phone app row gets
 * the preset for its name, written once - so the owner edits a real row, and
 * renaming a role later does not quietly change what its phones show.
 */
async function seedAppAccess() {
  const roles = await db.role.findMany({ where: { appAccess: null }, select: { id: true, storeId: true, name: true } });
  for (const r of roles) {
    await db.roleAppAccess.create({ data: { storeId: r.storeId, roleId: r.id, settings: presetForRole(r.name) } });
  }
  if (roles.length) console.log(`Phone app access: presets written for ${roles.length} role(s).`);
}

async function seedGstRates() {
  const stores = await db.store.findMany({ select: { id: true } });
  let seeded = 0;
  for (const st of stores) {
    if (await db.taxRate.count({ where: { storeId: st.id } })) continue;
    const type = await db.taxType.findFirst({ where: { storeId: st.id } })
      ?? await db.taxType.create({ data: { storeId: st.id, name: 'GST', code: 'GST' } });
    for (const r of [0, 5, 12, 18, 28]) {
      await db.taxRate.create({ data: { storeId: st.id, taxTypeId: type.id, name: `${r}%`, ratePct: r } });
    }
    seeded += 1;
  }
  if (seeded) console.log(`GST rates: standard slabs added to ${seeded} branch(es).`);
}

async function syncMenus() {
  let added = 0;

  for (const item of NEW_MENUS) {
    // Settings screens open from Settings only (5 Oct 2026); never give them a
    // sidebar row again, on an old database or a new one.
    if (isSettingsOnlyRoute(item.route)) continue;
    if (await db.menu.findFirst({ where: { route: item.route } })) continue;

    const parent = await db.menu.findFirst({ where: { label: item.parent, parentId: null } });
    if (!parent) {
      console.warn(`Menu group "${item.parent}" not found - ${item.label} was not added.`);
      continue;
    }

    // Placed before a named sibling rather than at a fixed index, so it lands
    // in the right spot even where somebody has reordered the group.
    const anchor = item.before
      ? await db.menu.findFirst({ where: { parentId: parent.id, label: item.before } })
      : null;
    const last = await db.menu.findFirst({
      where: { parentId: parent.id }, orderBy: { sort: 'desc' }, select: { sort: true },
    });
    const sort = anchor ? anchor.sort - 1 : (last?.sort ?? 0) + 1;

    const menu = await db.menu.create({
      data: { parentId: parent.id, label: item.label, route: item.route, icon: item.icon, sort },
    });

    // Visible everywhere by default. A menu row that exists but is switched off
    // for every store is indistinguishable from a bug, and the two-tier gating
    // is there for clients to narrow, not for shipping things dark.
    const stores = await db.store.findMany({ select: { id: true } });
    await db.storeMenuConfig.createMany({
      data: stores.map((s) => ({ storeId: s.id, menuId: menu.id, isEnabled: true })),
      skipDuplicates: true,
    });

    const roles = await db.role.findMany({ select: { id: true, storeId: true } });
    await db.roleMenuConfig.createMany({
      data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: menu.id, isVisible: true })),
      skipDuplicates: true,
    });

    added += 1;
    console.log(`Menu added: ${item.parent} → ${item.label} (${stores.length} stores, ${roles.length} roles)`);
  }

  if (added === 0) console.log('Menus: nothing to add.');
}

/**
 * Idempotent per organisation, mirroring `ensureChartOfAccounts` in
 * `server/ledger.ts` - this script cannot import that (it has its own
 * standalone `PrismaClient`, not the app's `server/db.ts`), so the same
 * two-pass "roots first, then children" logic is duplicated here rather
 * than shared. The data it seeds from, `STANDARD_CHART_OF_ACCOUNTS`, is not.
 */
/**
 * ACCOUNTS BECOMES A PLACE TO READ (9 Oct 2026).
 *
 * The group mixed two jobs: some rows recorded things (Transactions, Sales
 * Return, Credit Notes) and the rest only showed them. That is why nobody
 * could say what the menu was for, and why the same spend could be entered
 * from two places.
 *
 * After this:
 *   Accounts          - read only, with its own Dashboard at the top. The
 *                       return and credit-note rows point at read-only copies.
 *   Office Expenses   - its own top-level group. Spending is a daily job and
 *                       does not belong three clicks down.
 *   Returns & Refunds - its own top-level group, where returns and credit
 *                       notes are actually recorded.
 *
 * NO ROUTE CHANGES for the pages people already link to: `/transactions`,
 * `/sales-return` and `/credit-notes` keep their addresses, so bookmarks, the
 * document trail and anything shared on WhatsApp all still work.
 *
 * Idempotent, and sequential throughout - same connection-pooled-DB rule as
 * the other menu functions here.
 */
async function reshapeAccountsMenu() {
  const accounts = await db.menu.findFirst({ where: { label: 'Accounts', parentId: null } });
  if (!accounts) { console.log('Accounts menu: group not found, skipping.'); return; }

  // "User Account" was never a name anybody recognised - it is the staff
  // equivalent of Customer Account and Supplier Account above it.
  const staff = await db.menu.findFirst({ where: { route: '/user/account' } });
  if (staff && staff.label !== 'Staff Account') {
    await db.menu.update({ where: { id: staff.id }, data: { label: 'Staff Account' } });
  }

  // The dashboard goes first, because it is the answer to "how are we doing".
  await ensureLeaf(accounts.id, 'Dashboard', '/accounts/dashboard', 'bar-chart', -1);

  // Spending moves out to its own group, keeping its route.
  const expenses = await db.menu.findFirst({ where: { route: '/transactions' } });
  if (expenses && (expenses.parentId !== null || expenses.label !== 'Office Expenses')) {
    const at = (accounts.sort ?? 0) + 1;
    await db.menu.updateMany({
      where: { parentId: null, sort: { gte: at }, NOT: { id: expenses.id } },
      data: { sort: { increment: 1 } },
    });
    await db.menu.update({
      where: { id: expenses.id },
      data: { parentId: null, label: 'Office Expenses', icon: 'receipt', sort: at },
    });
  }

  // Returns and credit notes are recorded in their own group...
  const returns = await ensureRow(null, 'Returns & Refunds', 'rotate-ccw', (accounts.sort ?? 0) + 2);
  await ensureLeaf(returns.id, 'Sales Return', '/sales-return', 'rotate-ccw', 0);
  await ensureLeaf(returns.id, 'Credit Notes', '/credit-notes', 'file-text', 1);

  // ...and READ under Accounts, through copies that carry no buttons.
  await ensureLeaf(accounts.id, 'Sales Return', '/accounts/sales-return', 'rotate-ccw', 7);
  await ensureLeaf(accounts.id, 'Credit Notes', '/accounts/credit-notes', 'file-text', 8);

  // Put the group back in a readable order. The rows arrived over three years
  // from the seed, from two migrations and from the moves above, so their
  // `sort` values collide - which is why Sales Return was landing between
  // Sales Incentive and Bank Statement. Numbered explicitly here, by route,
  // so the order is a decision rather than an accident.
  const ORDER = [
    '/accounts/dashboard',
    '/receipts',
    '/reports/gst',
    '/supplier/account',
    '/customer/account',
    '/user/account',
    '/courier',
    '/accounts/sales-return',
    '/accounts/credit-notes',
    '/employee/incentive',
    '/bank/summary',
    '/settings/period-lock',
  ];
  for (const [i, route] of ORDER.entries()) {
    await db.menu.updateMany({ where: { parentId: accounts.id, route }, data: { sort: i } });
  }

  console.log('Accounts menu: read-only, with Office Expenses and Returns & Refunds as their own groups.');
}

async function syncChartOfAccounts() {
  const orgs = await db.organization.findMany({ select: { id: true } });
  let created = 0;

  for (const org of orgs) {
    const existing = await db.account.findMany({
      where: { organizationId: org.id }, select: { code: true },
    });
    const have = new Set(existing.map((a) => a.code));
    const missing = STANDARD_CHART_OF_ACCOUNTS.filter((a) => !have.has(a.code));
    if (missing.length === 0) continue;

    for (const a of missing.filter((x) => !x.parentCode)) {
      await db.account.create({
        data: {
          organizationId: org.id, code: a.code, name: a.name, type: a.type,
          subType: a.subType ?? null,
        },
      });
    }
    for (const a of missing.filter((x) => x.parentCode)) {
      const parent = await db.account.findUnique({
        where: { organizationId_code: { organizationId: org.id, code: a.parentCode! } },
        select: { id: true },
      });
      await db.account.create({
        data: {
          organizationId: org.id, code: a.code, name: a.name, type: a.type,
          subType: a.subType ?? null, parentId: parent?.id ?? null,
        },
      });
    }
    created += missing.length;
  }

  console.log(`Chart of accounts: ${orgs.length} organisation(s). Accounts created: ${created}.`);
}

/**
 * The starter set of the published holiday master list - `GovernmentHoliday`
 * rows an admin can toggle on per store, instead of typing every holiday out
 * by hand.
 *
 * Only FIXED-DATE national holidays, on purpose. Movable holidays (lunar-
 * calendar festivals) and state-specific ones are not something to guess at
 * from a maintenance script - they are real backlog, added by hand through
 * the admin screen as they are confirmed. Seeded for the current and next
 * calendar year, since a store planning next year's calendar should already
 * be able to pick these.
 */
const FIXED_NATIONAL_HOLIDAYS = [
  { month: 0, day: 26, name: 'Republic Day' },
  { month: 7, day: 15, name: 'Independence Day' },
  { month: 9, day: 2, name: 'Gandhi Jayanti' },
];

async function syncGovernmentHolidays() {
  const thisYear = new Date().getFullYear();
  let created = 0;

  for (const year of [thisYear, thisYear + 1]) {
    for (const h of FIXED_NATIONAL_HOLIDAYS) {
      const date = new Date(Date.UTC(year, h.month, h.day));
      const existing = await db.governmentHoliday.findFirst({
        where: { date, name: h.name, state: null },
        select: { id: true },
      });
      if (existing) continue;
      await db.governmentHoliday.create({ data: { date, name: h.name, state: null, year } });
      created += 1;
    }
  }

  console.log(`Government holiday master list: ${created} entr${created === 1 ? 'y' : 'ies'} added.`);
}

async function syncAdminDesignation() {
  const updated = await db.role.updateMany({
    where: { isSystem: true, name: 'Admin', designationCode: null },
    data: { designationCode: 'ADMIN', level: 1 },
  });
  console.log(`Admin designation: ${updated.count} role(s) given a default of ADMIN/level 1.`);
}

/** The five daily-use screens, in the order an HR user actually moves through them. */
const HRM_ORDER = ['HRM Dashboard', 'Payroll Dashboard', 'Hierarchy Flow', 'Recruitment', 'Onboarding'];

/** Everything else HRM used to hold - one-time setup, not opened day to day. */
const HRM_CONFIG_ORDER = [
  'Offboarding', 'Employee Mgmt', 'Salary Structure', 'Contracts',
  'Attendance Settings', 'Leave Types', 'Attendance Devices', 'Attendance Permissions',
  'Team Setup', 'Insurance and Policy',
];

async function reorderHrmMenu() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) { console.log('HRM menu reorder: HRM group not found, skipping.'); return; }

  // Superseded by `restructureHrmAccordion` (Phase 0, 20 Sep 2026), which
  // renamed 'Employee Mgmt' to 'Employees' and moved it under a new
  // 'Employee' row - this function's own "already done" check below keys
  // on the label 'Employee Mgmt' still existing, so once Phase 0 has run
  // that check silently reads as "never ran" and this function reactivates,
  // recreating a stray "HRM Configurations" group and dragging items (like
  // Offboarding) back out of their Phase-0 home. Bail out first, on the
  // same "does 'Employee' already exist under HRM" signal
  // `restructureHrmAccordion` itself uses to detect its own prior run.
  const phase0Done = await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Employee' } });
  if (phase0Done) { console.log('HRM menu reorder: superseded by the Phase 0 accordion, skipping.'); return; }

  // Checks the actual END STATE, not just whether the group exists - the
  // first production run created the group and then timed out on the
  // connection-pooled DB before moving anything into it (Promise.all fired
  // too many concurrent queries at connection_limit=1). Gating on mere
  // existence would leave that interrupted run permanently half-done, since
  // every step below is skipped once the group is there.
  const alreadyMoved = await db.menu.findFirst({
    where: { label: 'Employee Mgmt', parent: { label: 'HRM Configurations', parentId: null } },
  });
  if (alreadyMoved) { console.log('HRM menu reorder: already done.'); return; }

  let configGroup = await db.menu.findFirst({ where: { label: 'HRM Configurations', parentId: null } });
  const isNewGroup = !configGroup;
  if (!configGroup) {
    configGroup = await db.menu.create({
      data: { label: 'HRM Configurations', route: null, icon: 'settings', sort: hrm.sort },
    });
  }

  // Re-derives the whole top-level order from current DB state and rewrites
  // it every run (not only when the group is new) - safe to repeat after an
  // interrupted prior attempt, since it never assumes the group already
  // sits in the right place. Sequential, not Promise.all - see note above.
  const topLevel = (await db.menu.findMany({ where: { parentId: null }, orderBy: { sort: 'asc' } }))
    .filter((m) => m.id !== configGroup!.id);
  const hrmIdx = topLevel.findIndex((m) => m.id === hrm.id);
  const finalOrder = [...topLevel.slice(0, hrmIdx + 1), configGroup, ...topLevel.slice(hrmIdx + 1)];
  for (const [i, m] of finalOrder.entries()) {
    await db.menu.update({ where: { id: m.id }, data: { sort: i } });
  }
  if (isNewGroup) console.log('Menu group added: HRM Configurations');

  // storeMenuConfig/roleMenuConfig creation is unconditional and relies on
  // skipDuplicates, rather than living inside the `isNewGroup` branch - so
  // it still runs (and completes) even when the group was created by an
  // earlier, interrupted attempt and never got these rows.
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({
    data: stores.map((s) => ({ storeId: s.id, menuId: configGroup!.id, isEnabled: true })),
    skipDuplicates: true,
  });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({
    data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: configGroup!.id, isVisible: true })),
    skipDuplicates: true,
  });

  const children = await db.menu.findMany({ where: { parentId: hrm.id } });
  const byLabel = new Map(children.map((c) => [c.label, c]));

  for (const [i, label] of HRM_ORDER.entries()) {
    const m = byLabel.get(label);
    if (m) await db.menu.update({ where: { id: m.id }, data: { sort: i } });
  }

  let movedCount = 0;
  for (const [i, label] of HRM_CONFIG_ORDER.entries()) {
    const m = byLabel.get(label);
    if (!m) continue;
    await db.menu.update({ where: { id: m.id }, data: { parentId: configGroup.id, sort: i } });
    movedCount += 1;
  }

  console.log(`HRM menu reordered: 5 items kept in HRM, ${movedCount} moved to HRM Configurations.`);
}

/**
 * PHASE 0 OF THE HRM-IN-ATLAS ROADMAP, 20 Sep 2026 (§4.1) - the sidebar
 * accordion.
 *
 * Restructures HRM's flat children into the exact 14-row order the roadmap
 * specifies, merging in the standalone "Attendance" group (item 4's nine
 * children) and the standalone "HRM Configurations" group (split across
 * Employee/Payroll/HRM Settings per §4.2-§4.5's own module placement, not
 * relocated wholesale - see the roadmap's §4.11 for why: it was written
 * before Phase 2 built Work Schedules/Policies & Discipline/Employee
 * Configuration into that same group, and those three belong with Employee
 * per §4.2's real atlas-hrns submenu, not with the miscellaneous leftovers).
 * Renames a few labels along the way: HRM Dashboard → HRM Homescreen, HR
 * Summary → Dashboard, Employee Mgmt → Employees, Hierarchy Flow →
 * Organization Chart, Employee Configuration → Configuration, Attendance
 * Settings → Time Policies, Asset Management → Assets, Leave Types → Leave.
 *
 * Several of the 14 rows (Leave, Recruitment, Onboarding, Offboarding,
 * Project, Assets, Helpdesk, Reports) are plain links today rather than
 * accordions - each has exactly one destination right now, so nesting it
 * one level down would cost an extra click for nothing. Phase 3 gives
 * Payroll and Recruitment more children; when it does, converting a plain
 * link into a row with children is exactly what `ensureRow`/`moveInto`
 * below already do, so no new pattern is needed then.
 *
 * Runs once - detects its own prior run by checking whether "HRM" already
 * has an "Employee" child, a row only this migration ever creates. Sequential
 * throughout, never Promise.all - same connection-pooled-DB rule as
 * `reorderHrmMenu` above.
 */
async function ensureRow(parentId: string | null, label: string, icon: string, sort: number) {
  let row = await db.menu.findFirst({ where: { parentId, label } });
  if (row) return row;

  row = await db.menu.create({ data: { parentId, label, route: null, icon, sort } });
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({
    data: stores.map((s) => ({ storeId: s.id, menuId: row!.id, isEnabled: true })),
    skipDuplicates: true,
  });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({
    data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: row!.id, isVisible: true })),
    skipDuplicates: true,
  });
  return row;
}

async function ensureLeaf(parentId: string, label: string, route: string, icon: string, sort: number) {
  const existing = await db.menu.findFirst({ where: { route } });
  if (existing) { await db.menu.update({ where: { id: existing.id }, data: { parentId, sort } }); return; }

  const m = await db.menu.create({ data: { parentId, label, route, icon, sort } });
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({
    data: stores.map((s) => ({ storeId: s.id, menuId: m.id, isEnabled: true })),
    skipDuplicates: true,
  });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({
    data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: m.id, isVisible: true })),
    skipDuplicates: true,
  });
}

/** Re-parents an existing menu row (found anywhere, by its current label) under `parentId`. */
async function moveInto(parentId: string, label: string, sort: number, rename?: string) {
  const m = await db.menu.findFirst({ where: { label } });
  if (!m) { console.warn(`  HRM accordion: "${label}" not found - skipped.`); return; }
  await db.menu.update({
    where: { id: m.id },
    data: { parentId, sort, ...(rename ? { label: rename } : {}) },
  });
}

async function restructureHrmAccordion() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) { console.log('HRM accordion: HRM group not found, skipping.'); return; }

  const already = await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Employee' } });
  if (already) { console.log('HRM accordion: already done.'); return; }

  // Rename the two rows that were already plain links directly under HRM.
  const homescreen = await db.menu.findFirst({ where: { parentId: hrm.id, route: '/hrm' } });
  if (homescreen) await db.menu.update({ where: { id: homescreen.id }, data: { label: 'HRM Homescreen', sort: 0 } });
  const dashboard = await db.menu.findFirst({ where: { parentId: hrm.id, route: '/hrm/dashboard' } });
  if (dashboard) await db.menu.update({ where: { id: dashboard.id }, data: { label: 'Dashboard', sort: 1 } });

  // The four new accordion rows.
  const employeeRow = await ensureRow(hrm.id, 'Employee', 'user', 2);
  const attendanceRow = await ensureRow(hrm.id, 'Attendance', 'calendar', 3);
  const payrollRow = await ensureRow(hrm.id, 'Payroll', 'receipt', 5);
  const settingsRow = await ensureRow(hrm.id, 'HRM Settings', 'settings', 13);

  // Employee - real atlas-hrns submenu per §4.2.
  await moveInto(employeeRow.id, 'Employee Mgmt', 0, 'Employees');
  await moveInto(employeeRow.id, 'Hierarchy Flow', 1, 'Organization Chart');
  await moveInto(employeeRow.id, 'Work Schedules', 2);
  await moveInto(employeeRow.id, 'Policies & Discipline', 3);
  await moveInto(employeeRow.id, 'Employee Configuration', 4, 'Configuration');

  // Attendance - merges the old standalone group's six screens plus the
  // three settings items that were sitting in HRM Configurations.
  await moveInto(attendanceRow.id, 'Monthly Grid', 0);
  await moveInto(attendanceRow.id, 'Shift Log', 1);
  await moveInto(attendanceRow.id, 'Daily Work Status', 2);
  await moveInto(attendanceRow.id, 'Check-in/Check-out Log', 3);
  await moveInto(attendanceRow.id, 'Late Arrival & Early Departure', 4);
  await moveInto(attendanceRow.id, 'Monthly Summary', 5);
  await moveInto(attendanceRow.id, 'Attendance Settings', 6, 'Time Policies');
  await moveInto(attendanceRow.id, 'Attendance Devices', 7);
  await moveInto(attendanceRow.id, 'Attendance Permissions', 8);

  // Leave - one real destination today, so a plain link straight under HRM.
  await moveInto(hrm.id, 'Leave Types', 4, 'Leave');

  // Payroll.
  await moveInto(payrollRow.id, 'Payroll Dashboard', 0, 'Dashboard');
  await moveInto(payrollRow.id, 'Salary Structure', 1);
  await moveInto(payrollRow.id, 'Contracts', 2);

  // Recruitment / Onboarding / Offboarding - already single-page links,
  // just re-sorted into their new position (Offboarding was living under
  // HRM Configurations, not HRM, before this).
  await moveInto(hrm.id, 'Recruitment', 6);
  await moveInto(hrm.id, 'Onboarding', 7);
  await moveInto(hrm.id, 'Offboarding', 8);

  // Project / Reports - net new placeholder screens, reserving their
  // sidebar slot ahead of the Phase 4 / Phase 5 builds that fill them in.
  await ensureLeaf(hrm.id, 'Project', '/hrm/project', 'grid', 9);
  await ensureLeaf(hrm.id, 'Reports', '/hrm/reports', 'download', 12);

  // Assets / Helpdesk - moved out of Common Hub into HRM, per §4.1 item
  // 11/12. Common Hub keeps its other four children untouched.
  await moveInto(hrm.id, 'Asset Management', 10, 'Assets');
  await moveInto(hrm.id, 'Helpdesk', 11);

  // HRM Settings - the two genuinely miscellaneous leftovers.
  await moveInto(settingsRow.id, 'Team Setup', 0);
  await moveInto(settingsRow.id, 'Insurance and Policy', 1);

  // The two old standalone groups now have no children left - remove the
  // empty shells. Cascades their own store/role/user menu-config rows,
  // which serve no purpose once nothing routes through the group id itself.
  for (const label of ['Attendance', 'HRM Configurations']) {
    const group = await db.menu.findFirst({ where: { label, parentId: null } });
    if (!group) continue;
    const remaining = await db.menu.count({ where: { parentId: group.id } });
    if (remaining > 0) {
      console.warn(`  HRM accordion: "${label}" still has ${remaining} child(ren) - not deleting.`);
      continue;
    }
    await db.menu.delete({ where: { id: group.id } });
    console.log(`  HRM accordion: retired the standalone "${label}" group.`);
  }

  console.log('HRM accordion: restructured into the 14-row order.');
}

/**
 * PHASE 3 OF THE HRM-IN-ATLAS ROADMAP, 20 Sep 2026 (§4.5) - Payroll's new
 * screens (Loans & Advances, and whatever else this phase adds) land under
 * the top-level "HRM" group via `syncMenus`/`NEW_MENUS` above, the same as
 * every other brand new menu item - but `restructureHrmAccordion` only runs
 * once, so a later arrival needs its own idempotent nudge into the Payroll
 * row it actually belongs under. Re-parents by label, safe on every run:
 * once an item is already inside the row, its parentId update is a no-op.
 */
const PAYROLL_ROW_ADDITIONS = ['Loans & Advances', 'Encashments & Reimbursements', 'Income Tax'];

async function movePayrollItemsIntoRow() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) return;
  const payrollRow = await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Payroll' } });
  if (!payrollRow) return; // restructureHrmAccordion hasn't run on this database yet

  for (const label of PAYROLL_ROW_ADDITIONS) {
    const m = await db.menu.findFirst({ where: { label } });
    if (!m || m.parentId === payrollRow.id) continue;
    const last = await db.menu.findFirst({
      where: { parentId: payrollRow.id }, orderBy: { sort: 'desc' }, select: { sort: true },
    });
    await db.menu.update({ where: { id: m.id }, data: { parentId: payrollRow.id, sort: (last?.sort ?? -1) + 1 } });
    console.log(`  Payroll row: moved in "${label}".`);
  }
}

/**
 * PHASE 3, RECRUITMENT SLICE, 20 Sep 2026 (§4.6) - Recruitment gains real
 * children (Interviews, Talent Pool) alongside its existing single page, so
 * it needs to become an accordion row the way Phase 0 left Employee/
 * Attendance/Payroll, not the single-destination plain link it was.
 *
 * Reuses the EXISTING "Recruitment" menu row as the new parent (route set
 * to null) rather than creating a fresh row - its current store/role/user
 * visibility grants carry over untouched. A brand new "Candidates" leaf is
 * created at the route Recruitment used to point to directly, so the old
 * bookmark/link target still resolves to the same page.
 *
 * Runs once - detected by whether "Recruitment" still has a route (a
 * parent row never does).
 */
async function convertRecruitmentIntoAccordion() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) return;
  const recruitment = await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Recruitment' } });
  if (!recruitment) { console.log('Recruitment accordion: Recruitment row not found, skipping.'); return; }
  if (recruitment.route === null) { console.log('Recruitment accordion: already done.'); return; }

  await db.menu.update({ where: { id: recruitment.id }, data: { route: null } });

  const candidatesChild = await db.menu.create({
    data: { parentId: recruitment.id, label: 'Candidates', route: recruitment.route, icon: 'user-plus', sort: 0 },
  });
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({
    data: stores.map((s) => ({ storeId: s.id, menuId: candidatesChild.id, isEnabled: true })),
    skipDuplicates: true,
  });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({
    data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: candidatesChild.id, isVisible: true })),
    skipDuplicates: true,
  });

  for (const [i, label] of ['Interviews', 'Talent Pool'].entries()) {
    const m = await db.menu.findFirst({ where: { label, parentId: hrm.id } });
    if (m) await db.menu.update({ where: { id: m.id }, data: { parentId: recruitment.id, sort: i + 1 } });
  }

  console.log('Recruitment accordion: converted into Candidates/Interviews/Talent Pool.');
}

/**
 * PHASE 5, HELPDESK FAQs SLICE, 20 Sep 2026 (§4.9) - same "convert a plain
 * link into a row" migration as Recruitment above, now that Helpdesk gains
 * a second destination (FAQs) alongside its existing ticket screen.
 */
async function convertHelpdeskIntoAccordion() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) return;
  const helpdesk = await db.menu.findFirst({ where: { parentId: hrm.id, label: 'Helpdesk' } });
  if (!helpdesk) { console.log('Helpdesk accordion: Helpdesk row not found, skipping.'); return; }
  if (helpdesk.route === null) { console.log('Helpdesk accordion: already done.'); return; }

  await db.menu.update({ where: { id: helpdesk.id }, data: { route: null } });

  const ticketsChild = await db.menu.create({
    data: { parentId: helpdesk.id, label: 'Tickets', route: helpdesk.route, icon: 'alert-circle', sort: 0 },
  });
  const stores = await db.store.findMany({ select: { id: true } });
  await db.storeMenuConfig.createMany({
    data: stores.map((s) => ({ storeId: s.id, menuId: ticketsChild.id, isEnabled: true })),
    skipDuplicates: true,
  });
  const roles = await db.role.findMany({ select: { id: true, storeId: true } });
  await db.roleMenuConfig.createMany({
    data: roles.map((r) => ({ storeId: r.storeId, roleId: r.id, menuId: ticketsChild.id, isVisible: true })),
    skipDuplicates: true,
  });

  const faq = await db.menu.findFirst({ where: { label: 'FAQs', parentId: hrm.id } });
  if (faq) await db.menu.update({ where: { id: faq.id }, data: { parentId: helpdesk.id, sort: 1 } });

  console.log('Helpdesk accordion: converted into Tickets/FAQs.');
}

/**
 * D045's non-store-scoped roles (PlatformRole, not Role) and their
 * permission bundles. Platform permission keys use a `platformTenant.` /
 * `platformReseller.` module prefix specifically so the loop below that
 * grants every Permission to every STORE `isSystem` role can exclude them by
 * module - a tenant Admin role must never receive `platformTenant.suspend`.
 *
 * `TENANT_OWNER`/`TENANT_ADMIN`/`ENTITY_ADMIN` are seeded (D045: all 14
 * roles ship day one) but granted nothing yet - no screen consumes them in
 * this slice. Permissions determine capability per spec §10; an unused role
 * holding zero permissions is the correct state for it, not a gap.
 */
const PLATFORM_PERMISSIONS = [
  'platformTenant.view', 'platformTenant.create', 'platformTenant.suspend',
  // Superadmin-roadmap Slice 5, 22 Sep 2026 - "Access Tenant" (spec §8) is
  // materially more sensitive than merely listing/creating tenants, so it
  // gets its own key rather than riding on `platformTenant.view`. Not
  // gated behind `requireRootPlatformOwner()` (D055) - that guard's own
  // list (Slice 7 credential actions, Slice 9 PlatformConfig edits, Slice
  // 6 reseller-suspend) deliberately does not include this, so a Reseller
  // Owner can Access Tenant within their own subtree.
  'platformTenant.access',
  // Superadmin-roadmap Slice 7, 22 Sep 2026 - reset password / change
  // username / force logout / list a tenant's users. This permission alone
  // is NOT sufficient for a password reset or username change - those two
  // additionally require `requireRootPlatformOwner()` (D055) at the calling
  // action, so granting this key to PLATFORM_ADMIN is safe: the root check
  // is the real gate on the two most dangerous actions, not this key.
  'platformTenant.manageCredentials',
  // Slice 8 - toggling a tenant's `allowSelfServiceBusinessCreation`/
  // `allowLinkedAccounts` flags. Deliberately not granted to Reseller roles -
  // the roadmap frames this as "the platform owner decides."
  'platformTenant.manageFlags',
  // Slice 9 - `/platform/settings` (root-gated at the action, D055) and the
  // `/platform/audit` viewer respectively.
  'platformConfig.edit',
  'platformAudit.view',
  'platformReseller.view', 'platformReseller.create', 'platformReseller.suspend',
];

const PLATFORM_ROLES: {
  key: string; name: string; scopeType: PlatformRoleScopeType; permissions: string[];
}[] = [
  {
    key: 'PLATFORM_OWNER', name: 'Platform Owner', scopeType: 'PLATFORM',
    permissions: PLATFORM_PERMISSIONS,
  },
  {
    key: 'PLATFORM_ADMIN', name: 'Platform Admin', scopeType: 'PLATFORM',
    permissions: PLATFORM_PERMISSIONS,
  },
  {
    key: 'SUPPORT_ADMIN', name: 'Support Admin', scopeType: 'PLATFORM',
    // "Support Admin" is precisely who spec §8's "support and
    // administration" impersonation power is meant for.
    permissions: ['platformTenant.view', 'platformTenant.access', 'platformReseller.view'],
  },
  {
    key: 'RESELLER_OWNER', name: 'Reseller Owner', scopeType: 'RESELLER',
    permissions: [
      'platformTenant.view', 'platformTenant.create', 'platformTenant.suspend', 'platformTenant.access',
      // Read-only, and already scoped to this Reseller's own subtree by
      // `listAuditEvents` - seeing what happened to your own clients is not
      // the kind of action D055 reserves for the root owner.
      'platformAudit.view',
    ],
  },
  {
    key: 'RESELLER_ADMIN', name: 'Reseller Admin', scopeType: 'RESELLER',
    permissions: ['platformTenant.view', 'platformTenant.create'],
  },
  { key: 'TENANT_OWNER', name: 'Tenant Owner', scopeType: 'TENANT', permissions: [] },
  { key: 'TENANT_ADMIN', name: 'Tenant Admin', scopeType: 'TENANT', permissions: [] },
  { key: 'ENTITY_ADMIN', name: 'Entity Admin', scopeType: 'LEGAL_ENTITY', permissions: [] },
];

async function syncPlatformRoles() {
  for (const key of PLATFORM_PERMISSIONS) {
    const [module, action] = key.split('.');
    await db.permission.upsert({ where: { key }, update: {}, create: { key, module, action } });
  }

  let grantsAdded = 0;

  for (const r of PLATFORM_ROLES) {
    const role = await db.platformRole.upsert({
      where: { key: r.key },
      update: {},
      create: { key: r.key, name: r.name, scopeType: r.scopeType, isSystem: true },
    });

    for (const permKey of r.permissions) {
      const permission = await db.permission.findUniqueOrThrow({ where: { key: permKey } });
      const existing = await db.platformRolePermission.findUnique({
        where: { platformRoleId_permissionId: { platformRoleId: role.id, permissionId: permission.id } },
      });
      if (existing) continue;
      await db.platformRolePermission.create({
        data: { platformRoleId: role.id, permissionId: permission.id },
      });
      grantsAdded += 1;
    }
  }

  const total = await db.platformRole.count();
  console.log(`Platform roles: ${total} total. New permission grants: ${grantsAdded}.`);
}


/**
 * HRM IN THE ORDER AN HR PERSON WORKS, AND NO "HRM CONFIGURATIONS" (11 Oct
 * 2026, Pravin's live review, ops-pages demo tab 10). The top-level
 * "HRM Configurations" group had shrunk to Offboarding alone. Offboarding
 * moves into HRM as the last row and the empty group goes. Then HRM's rows
 * are put in order: people -> time -> pay -> performance -> hiring ->
 * support -> leaving. Rows not named here keep their place just before
 * Offboarding. Idempotent, sequential.
 */
const HRM_FINAL_ORDER = [
  'HRM Homescreen', 'Dashboard', 'Employee', 'Attendance', 'Leave Types & Allocation', 'Payroll',
  'Travel Allowance', 'Team Performance', 'Project', 'Recruitment', 'Onboarding', 'Assets',
  'Helpdesk', 'Insurance and Policy', 'Reports', 'Offboarding',
];
async function finalHrmMenu() {
  const hrm = await db.menu.findFirst({ where: { label: 'HRM', parentId: null } });
  if (!hrm) return;
  const off = await db.menu.findFirst({ where: { route: '/hrm/offboarding' } });
  if (off && off.parentId !== hrm.id) {
    await db.menu.update({ where: { id: off.id }, data: { parentId: hrm.id } });
    console.log('Menu: Offboarding moved into HRM.');
  }
  const cfg = await db.menu.findFirst({ where: { label: 'HRM Configurations', parentId: null } });
  if (cfg) {
    const left = await db.menu.findMany({ where: { parentId: cfg.id } });
    for (const m of left) await db.menu.update({ where: { id: m.id }, data: { parentId: hrm.id } });
    await db.menu.delete({ where: { id: cfg.id } });
    console.log(`Menu: HRM Configurations removed (${left.length} row(s) moved into HRM).`);
  }
  const kids = await db.menu.findMany({ where: { parentId: hrm.id }, orderBy: { sort: 'asc' } });
  const named = HRM_FINAL_ORDER.map((l) => kids.find((k) => k.label === l)).filter((k): k is NonNullable<typeof k> => !!k);
  const others = kids.filter((k) => !HRM_FINAL_ORDER.includes(k.label));
  const offRow = named.find((k) => k.label === 'Offboarding');
  const order = [...named.filter((k) => k.label !== 'Offboarding'), ...others, ...(offRow ? [offRow] : [])];
  let changed = 0;
  for (const [i, m] of order.entries()) {
    if (m.sort !== i) { await db.menu.update({ where: { id: m.id }, data: { sort: i } }); changed += 1; }
  }
  if (changed) console.log(`Menu: HRM rows put in order (${changed} moved).`);
}

/**
 * SERVICE TRACKER IS HISTORY, AND SAYS SO (11 Oct 2026, ops-pages demo tab 9).
 * People opened it to give a part, which always starts from the complaint. It
 * becomes "Repair challans (history)" at the end of Customer Service. Same
 * route, so bookmarks and the global search still land on it.
 */
async function renameServiceTracker() {
  const m = await db.menu.findFirst({ where: { route: '/services/repairs' } });
  if (!m || m.label === 'Repair challans (history)') return;
  const last = m.parentId ? await db.menu.findFirst({ where: { parentId: m.parentId }, orderBy: { sort: 'desc' }, select: { sort: true } }) : null;
  await db.menu.update({ where: { id: m.id }, data: { label: 'Repair challans (history)', ...(last ? { sort: last.sort + 1 } : {}) } });
  console.log('Menu: Service Tracker renamed "Repair challans (history)" and moved to the end of its group.');
}

async function main() {
  const before = await db.permission.count();

  // Split-out module keys that do not exist yet: after they are created, every
  // role is given them exactly where it could already act (lib/role-modules).
  // Only on first creation - an owner who later takes one away keeps it away.
  const splitKeys = SPLIT_MODULE_GRANTS.map((g) => g.key);
  const existingSplit = new Set((await db.permission.findMany({ where: { key: { in: splitKeys } }, select: { key: true } })).map((p) => p.key));
  const newSplit = splitKeys.filter((k) => !existingSplit.has(k));

  for (const key of PERMISSIONS) {
    const [module, action] = key.split('.');
    await db.permission.upsert({
      where: { key }, update: {}, create: { key, module, action },
    });
  }

  const all = await db.permission.findMany();
  const added = all.length - before;

  if (newSplit.length) {
    const idOf = new Map(all.map((p) => [p.key, p.id]));
    const roles = await db.role.findMany({
      where: { isSystem: false },
      select: { id: true, name: true, store: { select: { name: true } }, permissions: { select: { permission: { select: { key: true } } } } },
    });
    for (const r of roles) {
      const have = new Set(r.permissions.map((p) => p.permission.key));
      const give = splitGrantsFor(have).filter((k) => newSplit.includes(k));
      if (!give.length) continue;
      await db.rolePermission.createMany({ data: give.map((k) => ({ roleId: r.id, permissionId: idOf.get(k)! })), skipDuplicates: true });
      console.log(`Split modules: ${r.store.name} / ${r.name} given ${give.join(', ')} (same access as before).`);
    }
  }

  // Store-scoped roles never receive a platform-level permission - see the
  // module comment on PLATFORM_PERMISSIONS above.
  const storeGrantable = all.filter((p) => !p.module.startsWith('platform'));
  const adminRoles = await db.role.findMany({ where: { isSystem: true } });
  let grants = 0;

  for (const role of adminRoles) {
    for (const p of storeGrantable) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      });
      if (existing) continue;
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: p.id },
      });
      grants += 1;
    }
  }

  console.log(
    `Permissions: ${all.length} total (${added} new). ` +
    `Admin roles updated: ${adminRoles.length}, new grants: ${grants}.`,
  );

  if (adminRoles.length === 0) {
    console.warn('No roles marked isSystem were found - nothing was granted.');
  }

  await syncPlatformRoles();
  await syncThemeTokens();
  await syncNewMenuGroups();
  await restructureServicesMenu();
  await renameLeaveSetup();
  await promoteMyDesk();
  await syncDashboardRows();
  await syncMenus();
  await seedGstRates();
  await seedAppAccess();
  await seedTermsTemplates();
  await mergeHelpMenu();
  await addSopGuideMenu();
  await retireHelpMenu();
  await syncHrmAttendanceLeaves();
  await reshapeAccountsMenu();
  await syncChartOfAccounts();
  await syncGovernmentHolidays();
  await syncAdminDesignation();
  await reorderHrmMenu();
  await restructureHrmAccordion();
  await movePayrollItemsIntoRow();
  await convertRecruitmentIntoAccordion();
  await convertHelpdeskIntoAccordion();
  await finalHrmMenu();
  await renameServiceTracker();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
