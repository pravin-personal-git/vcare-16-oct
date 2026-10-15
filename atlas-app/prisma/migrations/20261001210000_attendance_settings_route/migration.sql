-- Attendance settings move out of /holiday/ (workstream I, 1 Oct 2026).
--
-- Biometric readers filed under "holiday" was the clearest single example of
-- the navigation problem Pravin reported: nobody would ever guess where to
-- look. The pages are now under /settings/attendance, alongside every other
-- settings screen.
--
-- The menu rows are updated in place, so an existing tenant's sidebar keeps
-- working. Old links still resolve: next.config.ts redirects /holiday/config
-- and everything under it, because people bookmark settings pages and the
-- handbook was handed to clients on paper.
UPDATE "Menu"
SET "route" = REPLACE("route", '/holiday/config', '/settings/attendance')
WHERE "route" LIKE '/holiday/config%';
