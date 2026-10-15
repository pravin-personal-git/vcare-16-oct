-- Sales-target periods move from UTC midnight to India midnight (9 Oct 2026).
--
-- lib/target-period now builds every month, quarter and financial year from
-- 00:00 IST to the last millisecond of its last IST day (it was UTC midnight,
-- so on Vercel a month began at 05:30 India time). A saved target is found by
-- its EXACT periodStart - it is part of the unique key - so the stored rows
-- move by the same 5 h 30 min in the same deploy, or every target already set
-- would stop being found.
--
-- 1 Apr 2026 00:00 UTC        -> 31 Mar 2026 18:30 UTC (= 1 Apr 00:00 IST)
-- 31 Mar 2027 23:59:59.999 UTC -> 31 Mar 2027 18:29:59.999 UTC (= 23:59:59.999 IST)
--
-- ONLY rows still on the old convention: periodStart exactly at a UTC
-- midnight. Run twice, it changes nothing the second time; a row somebody
-- made by hand at another time is left alone rather than guessed at. Labels
-- ("Aug 2026", "Q2 FY 2026-27") do not change - the period is the same, only
-- the instants that mark it.
--
-- No unique-key collision is possible: every matching row moves by the same
-- amount, and no row is already at 18:30 UTC on the eve of a period (the old
-- code never produced one).
UPDATE "UserTarget"
   SET "periodStart" = "periodStart" - INTERVAL '5 hours 30 minutes',
       "periodEnd"   = "periodEnd"   - INTERVAL '5 hours 30 minutes'
 WHERE "periodStart" = date_trunc('day', "periodStart");
