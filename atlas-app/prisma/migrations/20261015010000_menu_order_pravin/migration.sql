-- The sidebar, in the order Pravin asked for (14 Oct 2026).
--
-- His list, in his words: sales, customer service, inventory, products,
-- office expense, accounts, purchases, returns & refunds, hrm, financial
-- reports, suppliers, task manager, catalogue.
--
-- The work follows the day: sell it, service it, then what you hold, then
-- what you spend and what you owe, then people, then the reference lists
-- nobody opens daily. Inventory moves up behind Customer Service, which is
-- the change he actually asked for; the rest is the same list made explicit.
--
-- WHAT IS NOT IN HIS LIST stays where it belongs. Dashboard and My Desk open
-- the sidebar; Common Hub, Users & Roles, System Settings, Reference Data,
-- Settings and the SOP Guidebook close it. He was ordering the working
-- groups, not the bookends.
--
-- EVERY NUMBER IS SET, not nudged. Four groups shared a sort before this
-- (Catalogue with Suppliers at 8, Purchase with Returns & Refunds at 11) and
-- were being separated by an alphabetical tie-break - which is how "Purchase"
-- came out above "Returns & Refunds" by accident rather than by decision. A
-- tie is a sidebar that can reorder itself on a whim; there are none left.
--
-- Matched on label, so a group a client has renamed keeps its own place
-- rather than being dragged somewhere by a name it no longer uses.
-- Idempotent: running it twice sets the same numbers.

UPDATE "Menu" SET sort = v.sort
  FROM (VALUES
    -- the bookends, written down so nothing drifts into them
    ('Dashboard',          0),
    ('My Desk',            1),
    -- Pravin's thirteen, in his order
    ('Sales',              2),
    ('Customer Service',   3),
    ('Inventory',          4),
    ('Products',           5),
    ('Office Expenses',    6),
    ('Accounts',           7),
    ('Purchase',           8),
    ('Returns & Refunds',  9),
    ('HRM',               10),
    ('Financial Reports', 11),
    ('Suppliers',         12),
    ('Task Manager',      13),
    ('Catalogue',         14),
    -- set up once, then rarely opened
    ('Common Hub',        15),
    ('Users & Roles',     16),
    ('System Settings',   17),
    ('Reference Data',    18),
    ('Settings',          19),
    ('SOP Guidebook',     20)
  ) AS v(label, sort)
 WHERE "Menu".label = v.label
   AND "Menu"."parentId" IS NULL;
