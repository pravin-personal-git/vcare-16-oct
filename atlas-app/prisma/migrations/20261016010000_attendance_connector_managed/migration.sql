-- The office attendance connector, managed from Atlas (9 Oct 2026).
--
-- Settings the connector takes on every check-in, its version and last
-- check-in, its last status report and test result, and a "Test now" flag.
-- See the comments on AttendanceDevice in schema.prisma and
-- lib/attendance-capture/agent-protocol.ts.
--
-- Expand-only: six nullable columns, nothing existing changes, no backfill.
-- A device with no agentSettings uses the defaults (India +330, 5 min, 2 days).
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "agentSettings" JSONB;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "agentVersion" TEXT;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "agentSeenAt" TIMESTAMP(3);
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "agentStatus" JSONB;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "agentTest" JSONB;
ALTER TABLE "AttendanceDevice" ADD COLUMN IF NOT EXISTS "testRequestedAt" TIMESTAMP(3);
