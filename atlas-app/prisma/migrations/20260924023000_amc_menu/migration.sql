-- Puts "Maintenance Contracts" in the sidebar.
--
-- `Menu` is a GLOBAL table shared by every tenant - see the note in
-- src/server/provisioning.ts. A store's visible slice is which
-- StoreMenuConfig/RoleMenuConfig rows exist, and the resolver reads a missing
-- row as FALSE (`roleMap.get(m.id) ?? false` in administration.ts), so a new
-- menu with no config rows is invisible to everybody. That is exactly how all
-- six Vcare roles ended up with a blank sidebar earlier in this migration, so
-- the three steps below are not optional.
--
-- WHICH SIBLING IS MIRRORED, AND WHY IT IS NOT REPAIR TRACKER
--
-- The installation-challan migration mirrored '/services/repairs', because
-- whoever can see repair challans is exactly who should see installation
-- challans - the same field work signed off the same way.
--
-- This one mirrors '/services/complaints' instead. A maintenance contract is
-- not field work: it is the commercial agreement behind it. Every role that
-- runs the service desk needs to SEE which customers hold cover, because a
-- technician has to know before attending - and in this tenant all seven roles
-- hold `complaints.view`, so mirroring the complaints menu reaches all 22
-- staff. Writing a contract is separately gated on `customers.edit` in
-- services/amc/actions.ts, which is held by 8 managers, so the 13 technicians
-- see the screen read-only rather than not at all.
--
-- Mirroring a sibling rather than enabling it everywhere means no tenant gets
-- a menu item appearing that they had switched off, and no per-tenant decision
-- is made here.

-- 1. The menu row itself, placed immediately after its siblings.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text,
       p.id,
       'Maintenance Contracts',
       '/services/amc',
       'receipt',
       COALESCE((SELECT max(m.sort) FROM "Menu" m WHERE m."parentId" = p.id), 0) + 1,
       'WEB'::"Platform"
  FROM "Menu" p
 WHERE p.label = 'Services & Complaints'
   AND p."parentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/services/amc');

-- 2. Store-level: enabled wherever Customer Complaints is enabled, and left
--    alone wherever it is not.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/services/complaints'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/amc'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" x
      WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

-- 3. Role-level: same mirror, per role per store.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/services/complaints'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/amc'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
