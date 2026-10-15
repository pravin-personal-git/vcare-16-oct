-- Leave, working from home, and public holidays.
--
-- ADDITIVE ONLY. Two new tables, nothing touched on any existing one.
--
-- These are the other half of an attendance sheet. A shift says somebody WAS
-- at work; these say why they were not — and without them a person on approved
-- leave, a public holiday and a genuine no-show all render as the same empty
-- box on the month grid.

-- --------------------------------------------------------------- Holiday

CREATE TABLE "Holiday" (
    "id"        TEXT NOT NULL,
    "storeId"   TEXT NOT NULL,
    -- Midnight local. Compared by calendar day, never by timestamp.
    "date"      TIMESTAMP(3) NOT NULL,
    "name"      TEXT NOT NULL,
    -- public | optional | closure
    "kind"      TEXT NOT NULL DEFAULT 'public',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- Per store, not per organisation: a Chhattisgarh branch and a Kerala branch
-- close on different days, and a shared national list would mark the wrong
-- people absent in both.
CREATE UNIQUE INDEX "Holiday_storeId_date_name_key" ON "Holiday"("storeId", "date", "name");
CREATE INDEX "Holiday_storeId_date_idx" ON "Holiday"("storeId", "date");

ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------- LeaveRequest

CREATE TABLE "LeaveRequest" (
    "id"           TEXT NOT NULL,
    "storeId"      TEXT NOT NULL,
    "userId"       TEXT NOT NULL,

    -- leave | wfh | half_day
    "kind"         TEXT NOT NULL DEFAULT 'leave',

    -- Inclusive both ends. A single day has the same value in both.
    "fromDate"     TIMESTAMP(3) NOT NULL,
    "toDate"       TIMESTAMP(3) NOT NULL,
    "reason"       TEXT,

    -- pending | approved | rejected | cancelled.
    -- A rejected request is KEPT. "I did ask" is the commonest dispute in
    -- attendance, and a deleted row cannot answer it.
    "status"       TEXT NOT NULL DEFAULT 'pending',

    "decidedBy"    TEXT,
    "decidedAt"    TIMESTAMP(3),
    "decisionNote" TEXT,

    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaveRequest_storeId_status_idx" ON "LeaveRequest"("storeId", "status");
CREATE INDEX "LeaveRequest_storeId_userId_fromDate_idx"
    ON "LeaveRequest"("storeId", "userId", "fromDate");
-- The month grid asks "anything overlapping these 30 days" on every load.
CREATE INDEX "LeaveRequest_storeId_fromDate_toDate_idx"
    ON "LeaveRequest"("storeId", "fromDate", "toDate");

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE. Deleting the manager who approved a leave must not
-- delete the leave — the employee still had the day off.
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedBy_fkey"
    FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
