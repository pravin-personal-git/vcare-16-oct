-- Puts "Installation Challans" in the sidebar.
--
-- `Menu` is a GLOBAL table shared by every tenant - see the note in
-- src/server/provisioning.ts. A store's visible slice is which
-- StoreMenuConfig/RoleMenuConfig rows exist, and the resolver reads a missing
-- row as FALSE (`storeMap.get(m.id) ?? false` in administration.ts), so a new
-- menu with no config rows is invisible to everybody. Three steps, therefore:
-- create the menu, then mirror the visibility of the sibling it sits beside.
--
-- Mirroring "Repair Tracker" rather than enabling it everywhere is deliberate.
-- Whoever can see repair challans is exactly who should see installation
-- challans - it is the same field work, signed off the same way - and copying
-- the sibling means no tenant gets a menu item appear that they had switched
-- off, and no per-tenant decision has to be made here.

-- 1. The menu row itself, placed immediately after its siblings.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text,
       p.id,
       'Installation Challans',
       '/services/installations',
       'truck',
       COALESCE((SELECT max(m.sort) FROM "Menu" m WHERE m."parentId" = p.id), 0) + 1,
       'WEB'::"Platform"
  FROM "Menu" p
 WHERE p.label = 'Services & Complaints'
   AND p."parentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/services/installations');

-- 2. Store-level: enabled wherever Repair Tracker is enabled, and left alone
--    wherever it is not.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/services/repairs'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/installations'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" x
      WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

-- 3. Role-level: same mirror, per role per store.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/services/repairs'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/installations'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
