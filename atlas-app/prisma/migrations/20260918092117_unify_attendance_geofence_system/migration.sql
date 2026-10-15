-- Hand-written, NOT Prisma's auto-diff.
--
-- Prisma's own diff for this schema change reads `Shift` -> `AttendanceSession`
-- and `LocationPing` -> `AttendanceEvent` as unrelated models and proposes
-- DROP TABLE + CREATE TABLE, which would discard every real shift, call
-- attribution and location ping in the database. This migration instead
-- renames the tables and columns in place, preserving every row and every id -
-- CallLog.sessionId (renamed from shiftId) keeps pointing at exactly the same
-- rows it did before, just via its new name.
--
-- Two things are deliberately left half-finished here, on purpose, and
-- finished by a later migration after a one-off backfill script runs:
--   1. AttendanceSession.attendanceDayId stays nullable - there is no
--      AttendanceDay data yet to link existing sessions to.
--   2. The old hrnsAttendanceId/hrnsSyncedAt/hrnsError columns are renamed to
--      legacyHrnsAttendanceId/etc rather than dropped, so the backfill script
--      can copy each day's value onto the new AttendanceDay row it creates.

-- ============================================================ rename tables
ALTER TABLE "Shift" RENAME TO "AttendanceSession";
ALTER TABLE "LocationPing" RENAME TO "AttendanceEvent";

-- ========================================================== rename columns
ALTER TABLE "AttendanceEvent" RENAME COLUMN "shiftId" TO "sessionId";
ALTER TABLE "CallLog" RENAME COLUMN "shiftId" TO "sessionId";

ALTER TABLE "AttendanceSession" RENAME COLUMN "hrnsAttendanceId" TO "legacyHrnsAttendanceId";
ALTER TABLE "AttendanceSession" RENAME COLUMN "hrnsSyncedAt" TO "legacyHrnsSyncedAt";
ALTER TABLE "AttendanceSession" RENAME COLUMN "hrnsError" TO "legacyHrnsError";

-- ============================================ generalize device attribution
-- Web/manual/biometric sessions and events carry no paired device.
ALTER TABLE "AttendanceSession" ALTER COLUMN "deviceId" DROP NOT NULL;
ALTER TABLE "AttendanceEvent" ALTER COLUMN "deviceId" DROP NOT NULL;

-- =============================================== new columns on the session
ALTER TABLE "AttendanceSession" ADD COLUMN "source" TEXT;
-- Every session that existed before this migration came from the paired app -
-- that was the only source that could ever create one.
UPDATE "AttendanceSession" SET "source" = 'app';
ALTER TABLE "AttendanceSession" ALTER COLUMN "source" SET NOT NULL;

ALTER TABLE "AttendanceSession" ADD COLUMN "attendanceDayId" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN "startWithinPolicy" BOOLEAN;
ALTER TABLE "AttendanceSession" ADD COLUMN "startMatchedZoneId" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN "startDistanceM" INTEGER;

-- ================================================= new columns on the event
ALTER TABLE "AttendanceEvent" ADD COLUMN "complaintId" TEXT;
-- Normalize the old shift_start/shift_end source labels to the new naming -
-- purely cosmetic, the column always held a free-text label, never an enum.
UPDATE "AttendanceEvent" SET "source" = 'session_start' WHERE "source" = 'shift_start';
UPDATE "AttendanceEvent" SET "source" = 'session_end' WHERE "source" = 'shift_end';

-- ============================================== AttendancePolicy additions
ALTER TABLE "AttendancePolicy" ADD COLUMN "geofencingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendancePolicy" ADD COLUMN "ipRestrictionEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendancePolicy" ADD COLUMN "allowedIpRanges" TEXT;
ALTER TABLE "AttendancePolicy" ADD COLUMN "defaultRadiusMeters" INTEGER NOT NULL DEFAULT 150;

-- ====================================================== new tables
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "firstInAt" TIMESTAMP(3),
    "firstInSource" TEXT,
    "lastOutAt" TIMESTAMP(3),
    "lastOutSource" TEXT,
    "workedMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'not_marked',
    "hrnsAttendanceId" TEXT,
    "hrnsSyncedAt" TIMESTAMP(3),
    "hrnsError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceZone" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "policyId" TEXT,
    "label" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceZone_pkey" PRIMARY KEY ("id")
);

-- ====================================================== indexes
-- Old Shift/LocationPing indexes carried over unchanged with the table
-- rename (Postgres keeps index objects on a renamed table). Only new ones:
CREATE INDEX "AttendanceSession_attendanceDayId_idx" ON "AttendanceSession"("attendanceDayId");
CREATE INDEX "AttendanceDay_storeId_workDate_idx" ON "AttendanceDay"("storeId", "workDate");
CREATE UNIQUE INDEX "AttendanceDay_userId_workDate_key" ON "AttendanceDay"("userId", "workDate");
CREATE INDEX "AttendanceZone_storeId_isActive_idx" ON "AttendanceZone"("storeId", "isActive");

-- CallLog's index on the renamed column follows automatically (it was
-- "CallLog_shiftId_idx" on column shiftId; the column rename above keeps the
-- index valid under its old name). Give it the name schema.prisma expects.
ALTER INDEX "CallLog_shiftId_idx" RENAME TO "CallLog_sessionId_idx";

-- ====================================================== foreign keys
-- CallLog_shiftId_fkey and AttendanceEvent's old shiftId fkey both survived
-- the column rename under their old constraint names, still pointing at the
-- newly-renamed AttendanceSession table - functionally correct, cosmetic
-- name only. New foreign keys for the newly added columns:
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_attendanceDayId_fkey" FOREIGN KEY ("attendanceDayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceZone" ADD CONSTRAINT "AttendanceZone_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceZone" ADD CONSTRAINT "AttendanceZone_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AttendancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
