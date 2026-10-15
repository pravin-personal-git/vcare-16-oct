-- Inventory > Goods Dispatch Note > Complaint GDNs (30 Sep / 1 Oct 2026).
--
-- Complaint GDNs used to be a second table stapled under the sales-dispatch
-- register. They are now their own page, so the sidebar needs a row: the menu
-- is data, not code, and provision-prod.ts only covers databases that do not
-- exist yet.
--
-- Idempotent throughout. A database whose sidebar has been rearranged by hand
-- is left alone rather than "corrected".
--
-- NOTE THIS MAKES "Goods Dispatch Note" A PARENT. The sidebar renderer used to
-- turn any node with children into a toggle, which would have made the
-- register itself unreachable by click; it now renders a node that has BOTH a
-- route and children as a link with a separate chevron, so both destinations
-- stay one click away.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-inventory-complaint-gdns',
  parent."id",
  'Complaint GDNs',
  '/goods-dispatch/complaint-gdns',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."route" = '/goods-dispatch'
  AND parent."platform" = 'WEB'
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/goods-dispatch/complaint-gdns')
LIMIT 1;

-- Enabled wherever its parent is. A store that has switched Goods Dispatch
-- Note off keeps it off; nothing is switched on that was not already on.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-inventory-complaint-gdns', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."route" = '/goods-dispatch'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-complaint-gdns')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

-- And visible to exactly the roles that can already see the register.
-- Without this the item exists and nobody sees it: context.ts resolves menu
-- visibility as the UNION of rows where isVisible is true, so a menu with no
-- RoleMenuConfig row at all is hidden from everyone.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-inventory-complaint-gdns', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."route" = '/goods-dispatch'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-complaint-gdns')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
