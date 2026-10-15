-- One "Service Team Calls", not two. Vcare, 9 Oct 2026, from Pravin's
-- screenshot of the live sidebar: Customer Service ends with the same label
-- twice, and both open the service team's calls.
--
-- WHY THE LAST FIX MISSED IT. `20261013010000_one_place_for_calls` moved the
-- stray group's children into Customer Service "unless an item with that
-- route is already there". The stray child's route was the dead `/service`;
-- the real one is `/call-logs?team=service`. Different routes, so it was not
-- seen as a twin - it was MOVED in beside the real one instead of deleted.
-- Then `restructureServicesMenu` in the deploy sync found `/service` already
-- under the group and left it alone.
--
-- The sync is fixed in the same commit to delete this row, not move it.
--
-- Deleted only where the real row exists, so a tenant that somehow never got
-- `?team=service` keeps the one calls link it has. Its StoreMenuConfig and
-- RoleMenuConfig rows go with it (onDelete: Cascade); the kept row has its own.
DELETE FROM "Menu" old
 WHERE old.route = '/service'
   AND EXISTS (SELECT 1 FROM "Menu" keep WHERE keep.route = '/call-logs?team=service');
