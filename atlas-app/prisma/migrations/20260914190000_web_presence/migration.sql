-- Web presence — somebody marked themselves present from a browser.
--
-- ADDITIVE ONLY. One new table. Nothing existing is touched, and in particular
-- "Shift" is left exactly as it is.
--
-- WHY THIS IS NOT A COLUMN ON "Shift".
--
-- A shift is opened from a paired handset the company issued and can revoke.
-- This is a button on a web page, pressed by whoever holds the session. That is
-- the right record for a manager or an office worker who never carries the
-- field app, and the wrong record to treat as proof that anyone was anywhere.
-- Adding a "source" column to "Shift" would have buried that difference in a
-- string, and every query that forgot to filter on it would quietly treat the
-- two as equivalent. A separate table cannot be forgotten.

CREATE TABLE "WebPresence" (
    "id"               TEXT NOT NULL,
    "storeId"          TEXT NOT NULL,
    "userId"           TEXT NOT NULL,

    -- The business day, 'YYYY-MM-DD', resolved in Asia/Kolkata.
    --
    -- Text rather than a date, because it is a label for a day and not an
    -- instant. A timestamp here would be stored in UTC, and a 09:00 IST press
    -- would file itself against the previous day.
    "workDate"         TEXT NOT NULL,

    "clockInAt"        TIMESTAMP(3) NOT NULL,
    "clockOutAt"       TIMESTAMP(3),

    -- Where the browser said it was. All nullable: a browser can refuse
    -- location, and refusing to record attendance because of it would punish
    -- the employee for a setting.
    "inLat"            DECIMAL(9,6),
    "inLng"            DECIMAL(9,6),
    "inAccuracyM"      INTEGER,
    "outLat"           DECIMAL(9,6),
    "outLng"           DECIMAL(9,6),
    "outAccuracyM"     INTEGER,

    -- What happened when this was handed to Atlas-HRNS.
    "hrnsAttendanceId" TEXT,
    "hrnsSyncedAt"     TIMESTAMP(3),
    "hrnsError"        TEXT,

    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebPresence_pkey" PRIMARY KEY ("id")
);

-- One per person per day, matching how HRNS stores attendance. A second row for
-- the same day would be a second answer to a question that has one.
CREATE UNIQUE INDEX "WebPresence_userId_workDate_key" ON "WebPresence"("userId", "workDate");

CREATE INDEX "WebPresence_storeId_workDate_idx" ON "WebPresence"("storeId", "workDate");

ALTER TABLE "WebPresence" ADD CONSTRAINT "WebPresence_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebPresence" ADD CONSTRAINT "WebPresence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
