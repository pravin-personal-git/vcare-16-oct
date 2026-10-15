-- Inventory > Product History (1 Oct 2026).
--
-- "Where is my product" - type a serial number or in-house id and get the
-- whole life of that one item: who we bought it from and when, what it cost,
-- when it reached the shelf, who we sold it to, on what date, to which site,
-- what they paid, and every service call since.
--
-- Idempotent, inheriting both store and role visibility from its parent, so a
-- branch that has Inventory switched off does not suddenly gain a row.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-inventory-product-journey', parent."id", 'Product History', '/product-journey',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'Inventory' AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/product-journey')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-inventory-product-journey', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'Inventory'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-product-journey')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-inventory-product-journey', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'Inventory'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-product-journey')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
