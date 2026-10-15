-- The reporting line, and what counts as late.
--
-- ADDITIVE ONLY. One nullable column on "User" and one new table.
--
-- Nothing existing changes meaning. Every user starts with no manager and every
-- store starts with no policy row, and both screens read a sensible default
-- until somebody sets one. That is deliberate: a migration that invented an org
-- chart, or decided that everyone's week-off is Sunday, would be guessing about
-- people's pay.

-- ---------------------------------------------------------------- reporting

-- Nullable, and it must stay nullable: somebody sits at the top of every org
-- chart, and a new joiner has no manager on the day their record is created.
ALTER TABLE "User" ADD COLUMN "reportsToId" TEXT;

-- ON DELETE SET NULL rather than CASCADE. Deleting a manager must not delete
-- their team — that is a data-loss bug waiting for the day somebody resigns.
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey"
    FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- ------------------------------------------------------- attendance policy

CREATE TABLE "AttendancePolicy" (
    "id"             TEXT NOT NULL,
    "storeId"        TEXT NOT NULL,

    -- Sunday = 0, matching JavaScript's getDay(). An array so that patterns
    -- more complex than "the same day every week" can be added without a
    -- migration per day.
    "weekOffDays"    INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[],

    -- Minutes after the shift start that are still counted as on time.
    "graceMinutes"   INTEGER NOT NULL DEFAULT 10,

    -- Worked minutes at or above which a day is full, and below which it is a
    -- half day. Below the half-day figure it is an absence.
    "fullDayMinutes" INTEGER NOT NULL DEFAULT 480,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,

    -- The usual working day, 'HH:MM' local.
    "shiftStart"     TEXT NOT NULL DEFAULT '09:30',
    "shiftEnd"       TEXT NOT NULL DEFAULT '18:30',

    "updatedBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);

-- One per store. Two rows would mean two answers to "was he late", decided by
-- whichever the query happened to read first.
CREATE UNIQUE INDEX "AttendancePolicy_storeId_key" ON "AttendancePolicy"("storeId");

ALTER TABLE "AttendancePolicy" ADD CONSTRAINT "AttendancePolicy_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
