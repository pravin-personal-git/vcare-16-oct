-- Financial Reports > Document Numbers (3 Oct 2026).
--
-- Its own migration rather than appended to the one before it: that one had
-- already been applied to the development database, and an applied migration
-- must never be edited - Prisma records it as done and would silently skip the
-- new statements everywhere it had already run.
--
-- Where the gaps above are read. Under Financial Reports rather than Settings
-- because the audience is an accountant or an auditor, not an administrator.
--
-- Idempotent, inheriting both store and role visibility from its parent, so a
-- branch with Financial Reports switched off does not suddenly gain a row.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-reports-document-numbers', parent."id", 'Document Numbers', '/reports/document-numbers',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'Financial Reports' AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/reports/document-numbers')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-reports-document-numbers', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'Financial Reports'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-reports-document-numbers')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-reports-document-numbers', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'Financial Reports'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-reports-document-numbers')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
