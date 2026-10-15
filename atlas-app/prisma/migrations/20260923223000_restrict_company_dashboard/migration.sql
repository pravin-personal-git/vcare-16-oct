-- Takes the company financial dashboard away from the roles that should not
-- see it, and keeps the Dashboard link in their sidebar.
--
-- WHAT WENT WRONG
--
-- `dashboard/page.tsx` branches on one permission:
--
--     if (!ctx.permissions.has('dashboard.view'))  -> personal landing page
--                                                  -> otherwise the company
--                                                     Admin Dashboard
--
-- The six roles built for this tenant were all given `dashboard.view`, because
-- the source system listed "Dashboard" as a screen nearly everyone could read
-- and that was mapped across literally. In Atlas the permission does not mean
-- "can see a dashboard" - it means "can see the whole company's money".
--
-- The result on the live site: every one of the 26 staff logins, technicians
-- and helpers included, opened to receivables, profit, order due and stock
-- value. Not a crash, which is why nothing caught it - just the wrong people
-- looking at the company's finances.
--
-- Senior Manager and HOD keep it. Manager does not: that was the client's
-- explicit call, and Manager is the busiest role here (one holder has 3,020
-- jobs against her name), so it is the one that mattered most to get right.

-- 1. Remove the permission from the four roles that should not have it.
DELETE FROM "RolePermission" rp
 USING "Role" r, "Permission" p
 WHERE rp."roleId" = r.id
   AND rp."permissionId" = p.id
   AND p.key = 'dashboard.view'
   AND r.name IN ('Manager', 'Head Technician', 'Technician', 'Helper');

-- 2. Keep the Dashboard link visible for them.
--
-- The sidebar gate for /dashboard is `dashboard.view`, so removing the
-- permission would also remove the link - and every sign-in lands on
-- /dashboard, so the page they arrive at would have no entry in their own
-- menu. The personal landing page is not gated on that permission (it is what
-- you get when you LACK it), so the row is set visible explicitly here rather
-- than derived from a permission they no longer hold.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT r."storeId", r.id, m.id, true
  FROM "Role" r
 CROSS JOIN "Menu" m
 WHERE m.route = '/dashboard'
   AND m.platform = 'WEB'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = r."storeId" AND x."roleId" = r.id AND x."menuId" = m.id);

UPDATE "RoleMenuConfig" rc SET "isVisible" = true
  FROM "Menu" m
 WHERE rc."menuId" = m.id
   AND m.route = '/dashboard'
   AND m.platform = 'WEB'
   AND rc."isVisible" = false;
