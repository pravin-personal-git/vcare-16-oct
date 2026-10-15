-- Accounts > Close the Books (3 Oct 2026).
--
-- `ledger.ts` has refused to post into a locked `AccountingPeriod` since it was
-- written, and NOTHING in the codebase ever created one of those rows - no
-- screen, no action, no seed. The table was empty for every tenant, so the check
-- read zero rows and the lock could never fire: anybody could date an invoice
-- into a month whose GST return was already filed.
--
-- This is the key to a lock that already existed.
--
-- Under Accounts rather than System Settings because the person who closes a
-- month is the accountant, and it is a monthly task, not configuration.
--
-- Idempotent, inheriting both store and role visibility from its parent.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-accounts-period-lock', parent."id", 'Close the Books', '/settings/period-lock',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'Accounts' AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/period-lock')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-accounts-period-lock', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'Accounts'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-accounts-period-lock')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-accounts-period-lock', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'Accounts'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-accounts-period-lock')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
