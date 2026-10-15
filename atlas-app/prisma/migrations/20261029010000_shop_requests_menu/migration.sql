-- Shop requests in the sidebar (13 Oct 2026).
--
-- Pravin: the page at /sales/shop-requests works, but "in the menu there is
-- no way by which I can reach this page". `Menu` is global; a store sees an
-- item only through StoreMenuConfig, and a role only through RoleMenuConfig -
-- where a MISSING row resolves to false. So all three tiers are written here.
--
-- Who sees it: the people the page serves - buy requests become leads, visit
-- requests become complaints. A role sees the item where it already sees
-- Leads OR the Complaints Tracker; a store has it where either is enabled.
-- No tenant gains an item it had switched both of those off for.

-- 1. The menu row, directly after Leads under the same parent. Its later
-- siblings move down one first, so it does not tie with Customers.
UPDATE "Menu" m
   SET sort = m.sort + 1
  FROM "Menu" l
 WHERE l.route = '/crm/leads'
   AND m."parentId" = l."parentId"
   AND m.sort > l.sort
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/sales/shop-requests');

INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, g."parentId", 'Shop Requests', '/sales/shop-requests', 'shopping-cart',
       g.sort + 1, 'WEB'::"Platform"
  FROM "Menu" g
 WHERE g.route = '/crm/leads'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/sales/shop-requests')
 LIMIT 1;

-- 2. Store level: enabled wherever Leads or the Complaints Tracker is.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, bool_or(sc."isEnabled")
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route IN ('/crm/leads', '/services/complaints')
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/sales/shop-requests'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" x WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id)
 GROUP BY sc."storeId", nw.id;

-- 3. Role level: visible where the role sees Leads or the Complaints Tracker.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, bool_or(rc."isVisible")
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route IN ('/crm/leads', '/services/complaints')
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/sales/shop-requests'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id)
 GROUP BY rc."storeId", rc."roleId", nw.id;
