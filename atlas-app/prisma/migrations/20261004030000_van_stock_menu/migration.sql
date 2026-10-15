-- Van stock in the sidebar (2 Oct 2026).
--
-- `Menu` is global; a store sees an item only through StoreMenuConfig, and a
-- role only through RoleMenuConfig - where a MISSING row resolves to false,
-- which is how all six Vcare roles once ended up with a blank sidebar. So all
-- three tiers are written here, and the new item copies the visibility of its
-- nearest sibling, Serial & Batch Stock: whoever manages units is whoever
-- loads a van. No tenant gains an item it had switched off, and no per-tenant
-- decision is taken inside a migration.

-- 1. The menu row, directly after Serial & Batch Stock under the same parent.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, g."parentId", 'Van Stock', '/van-stock', 'truck',
       g.sort + 1, 'WEB'::"Platform"
  FROM "Menu" g
 WHERE g.route = '/stock-units'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/van-stock')
 LIMIT 1;

-- 2. Store level: enabled wherever Serial & Batch Stock is.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/stock-units'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/van-stock'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" x WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

-- 3. Role level: the same mirror, per role per store.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/stock-units'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/van-stock'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
