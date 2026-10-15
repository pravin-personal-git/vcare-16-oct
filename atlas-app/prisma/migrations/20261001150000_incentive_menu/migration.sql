-- Settings > Sales incentive in the sidebar (workstream H, 1 Oct 2026).
--
-- Idempotent, and inherits both StoreMenuConfig and RoleMenuConfig from its
-- parent: context.ts resolves menu visibility as the union of rows where
-- isVisible is true, so a menu row with no role config is invisible to
-- everyone.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-settings-incentive',
  parent."id",
  'Sales incentive',
  '/settings/incentive',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'System Settings'
  AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/incentive')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-settings-incentive', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-incentive')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-settings-incentive', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-incentive')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
