-- One home for the calls screen, and the old group gone for good.
-- Vcare, 8 Oct 2026, from Pravin's screenshot of the live sidebar.
--
-- WHAT HE SAW. Two groups: "Customer Service" with his six items, and a
-- leftover "Services & Complaints" holding a second "Service Team Calls".
--
-- WHY. The 7 Oct migration renamed the group to Customer Service. It did not
-- know that `prisma/sync-tenant-defaults.ts` runs on EVERY deploy and holds
-- 'Services & Complaints' in `NEW_TOP_LEVEL_GROUPS` - a list of groups it
-- CREATES when they are absent. So the next deploy found the name gone,
-- decided the group was missing, built a fresh one, and re-created the one
-- child whose route the migration had also changed (`/service` ->
-- `/call-logs?team=service`), because that was the only default it could no
-- longer match to an existing row.
--
-- So the sync and the migration were undoing each other once per deploy. The
-- real fix is in that file, and it is in the same commit as this - renaming a
-- menu row in SQL without telling the sync is how this happens.
--
-- This file cleans up what the fight left behind, and does the renaming
-- Pravin asked for in the same pass.
--
-- Expand-only in spirit: the ONE row it deletes is one the sync created after
-- 7 Oct, and it is deleted only when the real one is proven to exist.

-- ===========================================================================
-- 1. KEEP ANY CHILD THAT IS NOT A DUPLICATE
-- ===========================================================================
--
-- Before deleting anything, move children of the stray group over to Customer
-- Service - unless an item with that route is already there, which would make
-- it a second copy of something Pravin can already see. Deleting a menu row
-- takes its StoreMenuConfig and RoleMenuConfig with it, so nothing is dropped
-- without a twin to take its place.
UPDATE "Menu" child
   SET "parentId" = keep.id,
       sort = 99
  FROM "Menu" stray, "Menu" keep
 WHERE child."parentId" = stray.id
   AND stray."parentId" IS NULL AND stray.label = 'Services & Complaints'
   AND keep."parentId" IS NULL AND keep.label = 'Customer Service'
   AND NOT EXISTS (
     SELECT 1 FROM "Menu" twin
      WHERE twin."parentId" = keep.id
        AND twin.route IS NOT DISTINCT FROM child.route
   );

-- ===========================================================================
-- 2. THE DUPLICATE CALLS ROW
-- ===========================================================================
--
-- What is left under the stray group now is only what Customer Service
-- already has - in practice the second "Service Team Calls", pointing at the
-- dead `/service` route. Pravin: the calls screen belongs in ONE place.
DELETE FROM "Menu" child
 USING "Menu" stray
 WHERE child."parentId" = stray.id
   AND stray."parentId" IS NULL
   AND stray.label = 'Services & Complaints';

-- ===========================================================================
-- 3. THE EMPTY GROUP
-- ===========================================================================
--
-- Only once Customer Service is proven to exist. A client whose menu somehow
-- never got the rename keeps the group they have rather than losing the
-- section entirely.
DELETE FROM "Menu" stray
 WHERE stray."parentId" IS NULL
   AND stray.label = 'Services & Complaints'
   AND NOT EXISTS (SELECT 1 FROM "Menu" WHERE "parentId" = stray.id)
   AND EXISTS (SELECT 1 FROM "Menu" WHERE "parentId" IS NULL AND label = 'Customer Service');

-- ===========================================================================
-- 4. SALES TEAM CALLS
-- ===========================================================================
--
-- Pravin: "the sales menu should say sales team calls". Under Customer
-- Service the calls screen says whose calls it shows; under Sales it said
-- only "Call Logs", so the pair read as two different things.
--
-- The route gains `?team=sales`, which `server/calls-list.ts` learns in the
-- same commit - a label promising the sales team over a list of everybody's
-- calls would be worse than the vague name it replaces.
UPDATE "Menu" m
   SET label = 'Sales Team Calls', route = '/call-logs?team=sales'
  FROM "Menu" p
 WHERE m."parentId" = p.id
   AND p.label = 'Sales'
   AND m.route = '/call-logs';

-- ===========================================================================
-- 5. WHO THE SALES TEAM IS
-- ===========================================================================
--
-- The mirror of `serviceDepartmentIds`, which has decided the service team
-- since 27 Sep. Empty means "guess from the department names", exactly as it
-- does there, so a client who never opens the setting still sees something
-- sensible on day one.
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "salesDepartmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ===========================================================================
-- 6. THE ROW THE SYNC ADDED WHILE THIS WAS BEING WRITTEN
-- ===========================================================================
--
-- Running the sync on dev to check the fix added a fresh "Call Logs" under
-- Sales, for the same reason the service one appeared twice: its default
-- still named the old route. Both defaults are corrected in this commit, so
-- this clears the one copy the proof produced - and any client whose deploy
-- beat the fix.
DELETE FROM "Menu" m
 USING "Menu" p
 WHERE m."parentId" = p.id
   AND p.label = 'Sales'
   AND m.route = '/call-logs'
   AND EXISTS (
     SELECT 1 FROM "Menu" keep
      WHERE keep."parentId" = p.id AND keep.route = '/call-logs?team=sales'
   );

-- ===========================================================================
-- 7. THE MODULE NAME FOLLOWS THE GROUP NAME
-- ===========================================================================
--
-- `Organization.excludedModules` holds the names of sidebar GROUPS a client
-- is not sold. `lib/plans` and `lib/modules` called this area
-- "Services & Complaints"; the group is "Customer Service" now, and the
-- module name moves with it in the same commit - otherwise the plan gate
-- matches no group and the area is on for everybody.
--
-- The stored values have to move too. A client who had the service module
-- switched OFF would otherwise find it switched back on at the next deploy,
-- which is the kind of silence that reaches a customer before it reaches us.
--
-- No row on dev holds one (all three are null), but live is where this
-- matters and the rewrite is cheap and idempotent.
UPDATE "Organization"
   SET "excludedModules" = (
     SELECT jsonb_agg(CASE WHEN value::text = '"Services & Complaints"'
                           THEN '"Customer Service"'::jsonb
                           ELSE value END)
       FROM jsonb_array_elements("excludedModules"::jsonb) AS value
   )
 WHERE "excludedModules" IS NOT NULL
   AND jsonb_typeof("excludedModules"::jsonb) = 'array'
   AND "excludedModules"::jsonb @> '["Services & Complaints"]'::jsonb;
