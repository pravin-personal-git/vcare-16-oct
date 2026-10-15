-- Shifts and location pings.
--
-- ADDITIVE ONLY. No DROP, no ALTER of an existing column's type, nothing that
-- touches data already in the table. The two changes to "CallLog" are a new
-- nullable column and a new column with a default, both of which PostgreSQL 11+
-- applies without rewriting the table.
--
-- See 09-documentation/04-roadmap/ROAD-TO-FIRST-CLIENT.md section 2 for why
-- shifts exist, and 00-recall/OPEN-QUESTIONS.md Q21 for the outsideShift rule.

-- ---------------------------------------------------------------- Shift

CREATE TABLE "Shift" (
    "id"             TEXT NOT NULL,
    "storeId"        TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "deviceId"       TEXT NOT NULL,

    "startedAt"      TIMESTAMP(3) NOT NULL,
    "endedAt"        TIMESTAMP(3),

    -- Nullable throughout: location permission is separate from call-log
    -- permission and may be refused. A shift with no coordinates is still a
    -- valid shift; refusing to let someone start work because GPS was
    -- unavailable would be a bug.
    "startLat"       DECIMAL(9,6),
    "startLng"       DECIMAL(9,6),
    "endLat"         DECIMAL(9,6),
    "endLng"         DECIMAL(9,6),
    "startAccuracyM" INTEGER,
    "endAccuracyM"   INTEGER,

    -- Closed by the server because nobody pressed End Shift. Not attendance
    -- evidence: it records that someone started and never said they stopped.
    "autoClosed"     BOOLEAN NOT NULL DEFAULT false,

    "note"           TEXT,

    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shift_storeId_userId_startedAt_idx" ON "Shift"("storeId", "userId", "startedAt");
CREATE INDEX "Shift_storeId_startedAt_idx"        ON "Shift"("storeId", "startedAt");
-- Finding the open shift for a device. Hit on every single sync, so it earns
-- its keep more than the other two combined.
CREATE INDEX "Shift_deviceId_endedAt_idx"         ON "Shift"("deviceId", "endedAt");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------- LocationPing

CREATE TABLE "LocationPing" (
    "id"         TEXT NOT NULL,
    "storeId"    TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "deviceId"   TEXT NOT NULL,
    "shiftId"    TEXT,

    "lat"        DECIMAL(9,6) NOT NULL,
    "lng"        DECIMAL(9,6) NOT NULL,
    "accuracyM"  INTEGER,

    -- shift_start | shift_end | sync | manual
    "source"     TEXT NOT NULL,

    -- When the phone took the fix, not when we received it.
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LocationPing_storeId_userId_recordedAt_idx" ON "LocationPing"("storeId", "userId", "recordedAt");
CREATE INDEX "LocationPing_shiftId_recordedAt_idx"        ON "LocationPing"("shiftId", "recordedAt");

ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE. Deleting a shift must not delete the evidence of where
-- somebody was; the pings survive, unattached.
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------- CallLog gets a shift

ALTER TABLE "CallLog" ADD COLUMN "shiftId" TEXT;

-- Existing rows are all false, which is correct rather than merely convenient:
-- they were ingested before shifts existed, so no shift covered them, and
-- claiming otherwise would invent history. They will not appear in the
-- after-hours figure either, because that reads rows where the flag is TRUE.
ALTER TABLE "CallLog" ADD COLUMN "outsideShift" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "CallLog_shiftId_idx" ON "CallLog"("shiftId");

ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
