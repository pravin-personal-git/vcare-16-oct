-- F2.5 attendance capture: vendor adapters and punch-level idempotency.
-- ATTENDANCE-CAPTURE-SPEC.md, decisions D13 and D14. Expand-only.

-- Which adapter talks to this machine, where the last pull stopped, and how to
-- read in/out. `first_last` is the DEFAULT on purpose: at most sites nobody
-- presses IN or OUT, so every punch carries the same state code and trusting
-- it would record forty arrivals and no departures.
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "cursor" TEXT;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "directionMode" TEXT NOT NULL DEFAULT 'first_last';
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "clockSkewSeconds" INTEGER;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "lastSkewCheckedAt" TIMESTAMP(3);

-- One punch, exactly once.
--
-- Nothing recorded a punch individually before this, so replay safety rested
-- on clockIn being idempotent for TODAY - which does not hold for a batch that
-- is three days old, and a three-day-old batch is exactly what arrives when a
-- reader has been offline.
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "punchKey" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" TEXT,
    "punchAtUtc" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "verifyType" TEXT,
    "terminalRef" TEXT,
    "externalId" TEXT,
    "raw" JSONB,
    "appliedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- The whole point: re-sending a batch writes nothing the second time.
CREATE UNIQUE INDEX "AttendancePunch_deviceId_punchKey_key" ON "AttendancePunch"("deviceId", "punchKey");

CREATE INDEX "AttendancePunch_storeId_punchAtUtc_idx" ON "AttendancePunch"("storeId", "punchAtUtc");
CREATE INDEX "AttendancePunch_storeId_employeeCode_punchAtUtc_idx" ON "AttendancePunch"("storeId", "employeeCode", "punchAtUtc");
-- Drives the "waiting to be applied" queue.
CREATE INDEX "AttendancePunch_deviceId_appliedAt_idx" ON "AttendancePunch"("deviceId", "appliedAt");
CREATE INDEX "AttendancePunch_deletedAt_idx" ON "AttendancePunch"("deletedAt");

ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: a person leaving must not erase the attendance they
-- worked. Nothing is deleted (AGENTS.md section 4).
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Attendance is argued about at payroll time; who recorded what, and when, is
-- the answer.
DROP TRIGGER IF EXISTS atlas_audit ON "AttendancePunch";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendancePunch" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
