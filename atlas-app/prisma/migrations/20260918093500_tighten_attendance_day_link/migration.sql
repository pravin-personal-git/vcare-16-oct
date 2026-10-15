-- Follow-up to 20260918092117_unify_attendance_geofence_system.
--
-- DEPLOYMENT ORDER MATTERS FOR THIS ONE MIGRATION PAIR. Between the previous
-- migration and this one, `prisma/backfill-attendance-day.ts` MUST run and
-- link every existing AttendanceSession to an AttendanceDay - this migration
-- assumes that already happened and will fail on `SET NOT NULL` if any
-- session is still unlinked. In dev this already ran by hand; in production,
-- the build/deploy step must run the backfill script between these two
-- migrations, not skip straight to this one.

ALTER TABLE "AttendanceSession" ALTER COLUMN "attendanceDayId" SET NOT NULL;

-- The legacy columns have done their job (the backfill script copied
-- whatever they held onto the corresponding AttendanceDay row).
ALTER TABLE "AttendanceSession" DROP COLUMN "legacyHrnsAttendanceId";
ALTER TABLE "AttendanceSession" DROP COLUMN "legacyHrnsSyncedAt";
ALTER TABLE "AttendanceSession" DROP COLUMN "legacyHrnsError";
