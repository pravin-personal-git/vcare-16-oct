-- Customer Service: one heading, six items, in the order the work happens.
-- Vcare meeting, 7 Oct 2026.
--
-- Pravin's words: "mujhe lagta hai us pure menu ka heading hona chahiye
-- Customer Service" - then jobs, visits, installations, complaints, contracts,
-- repairs. His order, not mine.
--
-- Nothing is deleted and no route changes. A menu row that disappears takes
-- every StoreMenuConfig and RoleMenuConfig row with it, and rebuilding those
-- is how a client ends up with a blank sidebar. So: rename, re-sort, re-point.

-- ===========================================================================
-- 1. THE HEADING
-- ===========================================================================
UPDATE "Menu" SET label = 'Customer Service'
 WHERE "parentId" IS NULL AND label = 'Services & Complaints';

-- ===========================================================================
-- 2. THE TWO WRONG NAMES
-- ===========================================================================
--
-- "Repair Tracker" tracks every kind of service visit, not only repairs.
-- "Replacements" holds 566 cases of which most were repaired and returned -
-- calling the screen Replacements made people look elsewhere for a repair.
UPDATE "Menu" SET label = 'Service Tracker'          WHERE route = '/services/repairs';
UPDATE "Menu" SET label = 'Repairs & Replacements'   WHERE route = '/services/replacements';
UPDATE "Menu" SET label = 'Jobs Dashboard'           WHERE route = '/services/board';
UPDATE "Menu" SET label = 'Complaints Tracker'       WHERE route = '/services/complaints';
UPDATE "Menu" SET label = 'New Installations'        WHERE route = '/services/installations';

-- ===========================================================================
-- 3. THE MENU ITEM THAT WAS LYING
-- ===========================================================================
--
-- "Service Team Calls" pointed at /service - which is not a calls screen at
-- all. Anybody who clicked it looking for calls found something else and
-- concluded the calls were not being recorded. They are: /call-logs has had
-- date, person and type filters since September, and `?team=service` has
-- worked the whole time.
--
-- Pointed at the real screen, with the team already chosen, and named for what
-- it shows.
UPDATE "Menu"
   SET label = 'Service Team Calls', route = '/call-logs?team=service'
 WHERE route = '/service';

-- ===========================================================================
-- 4. THE ORDER PRAVIN ASKED FOR
-- ===========================================================================
--
-- 1 Jobs Dashboard · 2 Visit Scheduler · 3 New Installations ·
-- 4 Complaints Tracker · 5 Maintenance Contracts · 6 Repairs & Replacements
--
-- Service Tracker and Service Team Calls follow, because they are read from
-- inside a job far more often than they are opened on their own.
UPDATE "Menu" SET sort = 1 WHERE route = '/services/board';
UPDATE "Menu" SET sort = 2 WHERE route = '/services/visits';
UPDATE "Menu" SET sort = 3 WHERE route = '/services/installations';
UPDATE "Menu" SET sort = 4 WHERE route = '/services/complaints';
UPDATE "Menu" SET sort = 5 WHERE route = '/services/amc';
UPDATE "Menu" SET sort = 6 WHERE route = '/services/replacements';
UPDATE "Menu" SET sort = 7 WHERE route = '/services/repairs';
UPDATE "Menu" SET sort = 8 WHERE route = '/call-logs?team=service';

-- ===========================================================================
-- 5. TECHNICIAN PERFORMANCE MOVES TO HRM
-- ===========================================================================
--
-- It measures people, and HRM is where people are measured - attendance and
-- hierarchy are already there. It becomes Team Performance in wave 4; this
-- moves it now so the Customer Service list is the six items and nothing else.
--
-- Guarded: if there is no HRM parent this does nothing rather than orphaning
-- the row under a parent that does not exist.
UPDATE "Menu" m
   SET "parentId" = h.id, sort = 90, label = 'Team Performance'
  FROM "Menu" h
 WHERE m.route = '/services/technicians'
   AND h."parentId" IS NULL
   AND h.label ILIKE '%HRM%';
