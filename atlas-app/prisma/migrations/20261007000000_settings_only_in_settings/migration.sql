-- Settings live in Settings only (Pravin, 5 Oct 2026).
--
-- Twenty-six settings screens were reachable twice - from a sidebar group AND
-- from Settings (/settings/hub) - and eight more were settings that only the
-- sidebar knew about (Department, Team Setup, Work Schedules, Courier, Bank
-- Account, Document Numbers, Import Data, User Activity Log). Now Settings is the
-- one place: one top-level "Settings" item opens it, and the duplicates leave
-- the sidebar.
--
-- NOTHING IS DELETED. Rows are hidden with the F2 tombstone (`deletedAt`),
-- which every menu read now skips. Pages, permissions, bookmarks and links are
-- untouched - access is decided by permission (lib/route-access), never by the
-- menu, so hiding a row cannot lock anybody out of a page. Re-running changes
-- nothing. `sync-tenant-defaults.ts` looks rows up by route including hidden
-- ones, so it does not re-add them.
--
-- Employees (/settings/employees) STAYS: it is a daily register, not a
-- setting. Leave Types & Allocation (/holiday/leave-types) stays in HRM too:
-- it carries the comp-off / extra-leave Approve buttons and the balance grid
-- HR reads every week, so it is a work screen with setup inside it. So does Accounts > Sales Incentive (/employee/incentive), the
-- incentive report; only the incentive rules (/settings/incentive) move.

-- 1. "All Settings" becomes the top-level "Settings", just above Help & Handbook.
UPDATE "Menu"
   SET sort = sort + 1
 WHERE "parentId" IS NULL
   AND platform = 'WEB'
   AND route IS DISTINCT FROM '/settings/hub'
   AND sort >= COALESCE((SELECT h.sort FROM "Menu" h WHERE h."parentId" IS NULL AND h.route = '/handbook' AND h."deletedAt" IS NULL LIMIT 1), 2147483646)
   AND EXISTS (SELECT 1 FROM "Menu" s WHERE s.route = '/settings/hub' AND s."parentId" IS NOT NULL);

UPDATE "Menu"
   SET "parentId" = NULL,
       label = 'Settings',
       icon = 'settings',
       sort = COALESCE(
         (SELECT h.sort - 1 FROM "Menu" h WHERE h."parentId" IS NULL AND h.route = '/handbook' AND h."deletedAt" IS NULL LIMIT 1),
         (SELECT MAX(t.sort) + 1 FROM "Menu" t WHERE t."parentId" IS NULL)
       )
 WHERE route = '/settings/hub'
   AND "parentId" IS NOT NULL;

-- 2. Whoever could see any settings screen in the sidebar can see Settings.
--    (A missing RoleMenuConfig row resolves to invisible.)
WITH hub AS (SELECT id FROM "Menu" WHERE route = '/settings/hub' LIMIT 1),
moving AS (
  SELECT id FROM "Menu"
   WHERE platform = 'WEB'
     AND ((route LIKE '/settings/%' AND route NOT IN ('/settings/hub', '/settings/employees'))
          OR route IN ('/courier', '/hrm/work-schedules', '/hrm/employee-config',
                       '/hierarchy/team-setup', '/reports/document-numbers', '/reports/activity-log',
                       '/import', '/departments', '/bank/accounts'))
)
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT DISTINCT smc."storeId", (SELECT id FROM hub), true
  FROM "StoreMenuConfig" smc
 WHERE smc."isEnabled" AND smc."menuId" IN (SELECT id FROM moving)
   AND EXISTS (SELECT 1 FROM hub)
ON CONFLICT ("storeId", "menuId") DO UPDATE SET "isEnabled" = true;

WITH hub AS (SELECT id FROM "Menu" WHERE route = '/settings/hub' LIMIT 1),
moving AS (
  SELECT id FROM "Menu"
   WHERE platform = 'WEB'
     AND ((route LIKE '/settings/%' AND route NOT IN ('/settings/hub', '/settings/employees'))
          OR route IN ('/courier', '/hrm/work-schedules', '/hrm/employee-config',
                       '/hierarchy/team-setup', '/reports/document-numbers', '/reports/activity-log',
                       '/import', '/departments', '/bank/accounts'))
)
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT DISTINCT rmc."storeId", rmc."roleId", (SELECT id FROM hub), true
  FROM "RoleMenuConfig" rmc
 WHERE rmc."isVisible" AND rmc."menuId" IN (SELECT id FROM moving)
   AND EXISTS (SELECT 1 FROM hub)
ON CONFLICT ("storeId", "roleId", "menuId") DO UPDATE SET "isVisible" = true;

-- 3. "My Target" under Sales, read-only, where Sales Target sat. Visible to
--    whoever sees Sales Orders - the people whose orders it counts.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT 'menu-my-target', t."parentId", 'My Target', '/my/target', 'trending-up', t.sort, 'WEB'::"Platform"
  FROM "Menu" t
 WHERE t.route = '/settings/user-target' AND t.platform = 'WEB'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/my/target')
 LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", 'menu-my-target', sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/sales/orders'
 WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m.id = 'menu-my-target')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", 'menu-my-target', rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/sales/orders'
 WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m.id = 'menu-my-target')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;

-- 4. Insurance and Policy is daily work, not a setting: straight under HRM,
--    out of "HRM Settings" (which empties and is hidden below).
UPDATE "Menu" r
   SET "parentId" = hrm.id,
       sort = COALESCE((SELECT MAX(c.sort) + 1 FROM "Menu" c WHERE c."parentId" = hrm.id), 0)
  FROM "Menu" hrm
 WHERE r.route = '/hrm/renewal'
   AND hrm."parentId" IS NULL AND hrm.label = 'HRM' AND hrm.route IS NULL AND hrm."deletedAt" IS NULL
   AND r."parentId" IS DISTINCT FROM hrm.id;

-- 5. Hide the settings screens from the sidebar.
UPDATE "Menu"
   SET "deletedAt" = NOW(), "deletedBy" = 'migration:settings_only_in_settings'
 WHERE "deletedAt" IS NULL
   AND platform = 'WEB'
   AND ((route LIKE '/settings/%' AND route NOT IN ('/settings/hub', '/settings/employees'))
        OR route IN ('/courier', '/hrm/work-schedules', '/hrm/employee-config',
                     '/hierarchy/team-setup', '/reports/document-numbers', '/reports/activity-log',
                     '/import', '/departments', '/bank/accounts'));

-- 6. Hide groups left with nothing in them (System Settings, Users & Roles,
--    Reference Data, HRM Settings, ...). Three passes for nested groups. Only
--    groups that HAD children - a group already empty for another reason is
--    somebody else's decision.
UPDATE "Menu" p
   SET "deletedAt" = NOW(), "deletedBy" = 'migration:settings_only_in_settings'
 WHERE p."deletedAt" IS NULL AND p.platform = 'WEB' AND p.route IS NULL
   AND EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id)
   AND NOT EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id AND c."deletedAt" IS NULL);

UPDATE "Menu" p
   SET "deletedAt" = NOW(), "deletedBy" = 'migration:settings_only_in_settings'
 WHERE p."deletedAt" IS NULL AND p.platform = 'WEB' AND p.route IS NULL
   AND EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id)
   AND NOT EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id AND c."deletedAt" IS NULL);

UPDATE "Menu" p
   SET "deletedAt" = NOW(), "deletedBy" = 'migration:settings_only_in_settings'
 WHERE p."deletedAt" IS NULL AND p.platform = 'WEB' AND p.route IS NULL
   AND EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id)
   AND NOT EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = p.id AND c."deletedAt" IS NULL);
