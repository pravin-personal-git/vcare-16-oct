-- Settings > Document layouts in the sidebar (workstream C, 1 Oct 2026).
-- Idempotent, inheriting both store and role visibility from its parent.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-settings-documents', parent."id", 'Document layouts', '/settings/documents',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'System Settings' AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/documents')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-settings-documents', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-documents')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-settings-documents', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-documents')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
