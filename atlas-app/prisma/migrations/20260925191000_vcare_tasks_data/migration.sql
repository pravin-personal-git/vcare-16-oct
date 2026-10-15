-- Vcare: the old app's Task Management section (health check follow-up,
-- 25 Sep 2026). Read-only from the source on 25 Sep 2026: 3 tasks in total
-- (numbering reached TS20250021; the rest had been deleted in the old app).
-- Each goes to the same person where that person was migrated (User.legacyRef);
-- otherwise it is left unassigned and the description says who had it.
-- The Vcare branch is the one holding the migrated complaints. Guarded: does
-- nothing on a database without Vcare data, and a re-run adds nothing.
WITH vc AS (
  SELECT "storeId" FROM "Complaint" WHERE "legacyRef" IS NOT NULL
   GROUP BY "storeId" ORDER BY count(*) DESC LIMIT 1
)
INSERT INTO "Task" (id, "storeId", title, description, status, priority, "createdAt", "updatedAt", "completedAt", "assignedToId", "legacyRef")
SELECT gen_random_uuid()::text, vc."storeId", v.title,
       v.descr || CASE WHEN u.id IS NULL AND v.who <> '' THEN ' In the old app it was assigned to ' || v.who || ', who does not have an Atlas login.' ELSE '' END,
       v.status, v.priority, v.created::timestamptz, now(), v.completed::timestamptz, u.id, v.ref
  FROM (VALUES
    ('TS20250012', 'BILL', 'MAKE 2 BILL IN MARG

[Old system] Task TS20250012. It had a voice note in the old app.', 'Completed', 'Normal', '2025-07-11T07:13:01.580Z', '2025-08-04T13:06:40.416Z', 'LEGACY_USER:685d2e126fad81945f2a343d', 'nishanjeetsangh@gmail.com'),
    ('TS20250020', 'test', 'test

[Old system] Task TS20250020. It had a voice note in the old app.', 'Pending', 'Normal', '2025-09-04T06:55:05.489Z', NULL, 'LEGACY_USER:688879ca22f46c356c690e06', 'h@gmail.com'),
    ('TS20250021', 'Visit bank', 'Visit bank description

[Old system] Task TS20250021. It had a voice note in the old app.', 'Completed', 'High', '2025-09-26T10:02:12.029Z', '2025-09-26T10:03:44.735Z', 'LEGACY_USER:68d663c16ec71b0132a71e25', 'tm@gmail.com')
  ) AS v(ref, title, descr, status, priority, created, completed, legacy_user, who)
  CROSS JOIN vc
  LEFT JOIN "User" u ON u."legacyRef" = v.legacy_user
 WHERE NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."storeId" = vc."storeId" AND t."legacyRef" = v.ref);
