-- The header's icon rail moves into the menu. Pravin, 14 Oct 2026.
--
-- Six unlabelled icons sat in the top-right corner. Four of them were only
-- links to pages: SOP Guidebook, Messages, Notes and Settings. He asked for
-- those four to go, for Notifications to stay (with a bell rather than a
-- warning triangle), and for whatever leaves to land in Common Hub.
--
-- Two of the four were ALREADY in the sidebar and need nothing here:
--   Notes    -> /terms           = Common Hub > Terms & Policy
--   Settings -> /settings/system = System Settings > System Config
--                                  (and the Settings hub is top-level)
-- So this file moves the SOP Guidebook in and adds Messages, which was the
-- one page in the whole rail that the sidebar did not list at all.
--
-- Fullscreen stays in the rail. It is a window control, not a place, and
-- there is no menu row that could mean it.
--
-- Nothing is deleted: moving a menu row keeps its id, so the branch and role
-- visibility settings attached to it come along. Idempotent.

-- ===========================================================================
-- 1. THE SOP GUIDEBOOK JOINS COMMON HUB
-- ===========================================================================
--
-- It has been a top-level item since 6 Oct, directly because the rail's help
-- icon pointed at it. With the icon gone it belongs with the other reading
-- material - the handbook, the notices, the policies.
UPDATE "Menu" m
   SET "parentId" = hub.id, sort = 4
  FROM "Menu" hub
 WHERE hub."parentId" IS NULL
   AND hub.label = 'Common Hub'
   AND m.route = '/handbook/sop'
   AND m."parentId" IS DISTINCT FROM hub.id;

-- ===========================================================================
-- 2. MESSAGES GETS A MENU ROW AT LAST
-- ===========================================================================
--
-- The inbox has been real since 18 September and reachable only through that
-- envelope icon - so with the icon gone it would have had no door at all.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, hub.id, 'Messages', '/messages', 'mail', 5, 'WEB'
  FROM "Menu" hub
 WHERE hub."parentId" IS NULL
   AND hub.label = 'Common Hub'
   AND NOT EXISTS (SELECT 1 FROM "Menu" WHERE route = '/messages');

-- A new menu row is invisible until each branch and each role is told about
-- it, which is why one added by hand never appears for anybody.
-- No `id` column on these two: they are keyed by the pair (and the triple)
-- itself, and `updatedAt` fills from the database's own default.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT s.id, m.id, true
  FROM "Store" s CROSS JOIN "Menu" m
 WHERE m.route = '/messages'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" c WHERE c."storeId" = s.id AND c."menuId" = m.id
   );

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT r."storeId", r.id, m.id, true
  FROM "Role" r CROSS JOIN "Menu" m
 WHERE m.route = '/messages'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" c WHERE c."roleId" = r.id AND c."menuId" = m.id
   );

-- ===========================================================================
-- 3. COMMON HUB IN A SENSIBLE ORDER
-- ===========================================================================
--
-- Its rows were numbered -1, 0, 1, 3 - the gaps left by things inserted and
-- retired over the months. Renumbered 0..5 now that two more have joined,
-- so nothing depends on a negative sort or an accidental tie.
UPDATE "Menu" m SET sort = v.sort
  FROM (VALUES
    ('/handbook',     0),   -- How Atlas Works
    ('/notices',      1),   -- Notices & Announcements
    ('/files',        2),   -- Shared Files & Docs
    ('/terms',        3),   -- Terms & Policy  (the rail's "Notes")
    ('/handbook/sop', 4),   -- SOP Guidebook   (was top-level)
    ('/messages',     5)    -- Messages        (was the envelope icon)
  ) AS v(route, sort),
       "Menu" hub
 WHERE hub."parentId" IS NULL
   AND hub.label = 'Common Hub'
   AND m."parentId" = hub.id
   AND m.route = v.route;
