-- Shop Requests moves under Catalogue (13 Oct 2026, Pravin: "that is where it
-- should be"). The address /sales/shop-requests does not change - links,
-- bookmarks and the bell keep working; only the menu row moves.
--
-- Catalogue was a single link (/catalogue). It becomes a group holding two
-- rows: Catalogue (the same page) and Shop Requests. Who sees what does not
-- change: the new Catalogue row copies the old row's branch and role
-- settings exactly, and Shop Requests keeps its own. Idempotent - it only
-- acts while the Catalogue row still carries a route.

-- 1. The Catalogue page as a row inside the group, with the old row's settings.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, g.id, 'Catalogue', '/catalogue', g.icon, 0, 'WEB'::"Platform"
  FROM "Menu" g
 WHERE g.route = '/catalogue' AND g."parentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/catalogue' AND x."parentId" = g.id);

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", c.id, sc."isEnabled"
  FROM "Menu" g
  JOIN "Menu" c ON c."parentId" = g.id AND c.route = '/catalogue'
  JOIN "StoreMenuConfig" sc ON sc."menuId" = g.id
 WHERE g.route = '/catalogue' AND g."parentId" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", c.id, rc."isVisible"
  FROM "Menu" g
  JOIN "Menu" c ON c."parentId" = g.id AND c.route = '/catalogue'
  JOIN "RoleMenuConfig" rc ON rc."menuId" = g.id
 WHERE g.route = '/catalogue' AND g."parentId" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "UserMenuConfig" ("storeId", "userId", "menuId", "isVisible")
SELECT uc."storeId", uc."userId", c.id, uc."isVisible"
  FROM "Menu" g
  JOIN "Menu" c ON c."parentId" = g.id AND c.route = '/catalogue'
  JOIN "UserMenuConfig" uc ON uc."menuId" = g.id
 WHERE g.route = '/catalogue' AND g."parentId" IS NULL
ON CONFLICT DO NOTHING;

-- 2. Shop Requests moves into the group, second; it keeps its own settings.
UPDATE "Menu" sr
   SET "parentId" = g.id, sort = 1
  FROM "Menu" g
 WHERE sr.route = '/sales/shop-requests'
   AND g.route = '/catalogue' AND g."parentId" IS NULL;

-- 3. The group itself stops being a link (last, so steps 1-2 can find it).
UPDATE "Menu" SET route = NULL
 WHERE route = '/catalogue' AND "parentId" IS NULL
   AND EXISTS (SELECT 1 FROM "Menu" c WHERE c."parentId" = "Menu".id AND c.route = '/catalogue');
