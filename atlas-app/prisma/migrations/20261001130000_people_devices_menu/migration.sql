-- Settings > People & devices (workstream I, 1 Oct 2026).
--
-- One employee's access was spread over four tables and six screens. Nowhere
-- could you see their roles, their phone, whether it is paired, and how to cut
-- it off - which is exactly what is needed when a technician loses a phone on
-- a Friday evening.
--
-- Idempotent, and inherits both StoreMenuConfig and RoleMenuConfig from its
-- parent: context.ts resolves visibility as the union of isVisible rows, so a
-- menu row with no role config is invisible to everyone.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-settings-people-devices',
  parent."id",
  'People & devices',
  '/settings/people-devices',
  COALESCE((SELECT MIN(child."sort") - 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'System Settings'
  AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/people-devices')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-settings-people-devices', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-people-devices')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-settings-people-devices', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-people-devices')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
