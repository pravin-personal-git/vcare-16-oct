-- Settings hub in the sidebar (workstream A, 1 Oct 2026).
--
-- One home for configuration. The 24 existing settings screens are NOT moved:
-- relocating every route would break bookmarks, saved views and links on the
-- same day the client is signing the product off. The hub makes them findable
-- first; relocating them is a later, separate step.
--
-- Idempotent, and placed first in the group. A database whose sidebar has been
-- rearranged by hand is left alone rather than "corrected".
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-settings-hub',
  parent."id",
  'All Settings',
  '/settings/hub',
  COALESCE((SELECT MIN(child."sort") - 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'System Settings'
  AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/hub')
LIMIT 1;

-- Enabled and visible wherever its parent already is. Nothing is switched on
-- that was not already on, and a menu row with no RoleMenuConfig is invisible
-- to everyone (context.ts resolves visibility as the union of isVisible rows).
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-settings-hub', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-hub')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-settings-hub', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-hub')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
