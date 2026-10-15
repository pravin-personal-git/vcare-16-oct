-- F2.5 / D14: the clock-in photograph.
--
-- NOT A FACE SCAN, AND THE DISTINCTION IS LOAD-BEARING. There is no enrolment,
-- no template and no matching anywhere in this feature, so nothing stored here
-- is biometric data under DPDP 2023 - and this table deliberately has no column
-- that could hold any. A face template is one of the few things a client cannot
-- ask us to add later without a new decision.
--
-- `storagePath` is an object key in a PRIVATE bucket, never a URL: a permanent
-- link to a photograph of somebody's face works forever, and for anyone, the
-- moment it leaks into a chat or a screenshot. Links are signed per request for
-- somebody who already holds a session.
--
-- `sessionId` is nullable ON PURPOSE, and ON DELETE SET NULL. A photo taken
-- against a punch the server refused still has to be kept: "he says he clocked
-- in" is exactly the argument the picture is there to settle.
CREATE TABLE IF NOT EXISTS "AttendancePhoto" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "direction" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "accuracyM" INTEGER,
    "mocked" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- F2 sync columns, same five as every other ledger table.
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePhoto_pkey" PRIMARY KEY ("id")
);

-- The supervisor's query is always "this person, this month", in that order.
CREATE INDEX IF NOT EXISTS "AttendancePhoto_storeId_userId_capturedAt_idx"
    ON "AttendancePhoto"("storeId", "userId", "capturedAt");
CREATE INDEX IF NOT EXISTS "AttendancePhoto_sessionId_idx"
    ON "AttendancePhoto"("sessionId");

ALTER TABLE "AttendancePhoto"
    ADD CONSTRAINT "AttendancePhoto_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePhoto"
    ADD CONSTRAINT "AttendancePhoto_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePhoto"
    ADD CONSTRAINT "AttendancePhoto_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "AttendanceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
