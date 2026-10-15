-- 14 Oct 2026 (Vcare): a biometric employee code mapped to a person is
-- remembered, so the next punch from that code is attributed on arrival.
-- Before this, mapping stamped only the punches already received.
-- Expand-only: one new table.
CREATE TABLE IF NOT EXISTS "AttendanceCodeMap" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" TEXT,
    "mappedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "AttendanceCodeMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceCodeMap_storeId_employeeCode_key" ON "AttendanceCodeMap"("storeId", "employeeCode");
DO $$ BEGIN
  ALTER TABLE "AttendanceCodeMap" ADD CONSTRAINT "AttendanceCodeMap_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AttendanceCodeMap" ADD CONSTRAINT "AttendanceCodeMap_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who decided which number is which person is audited.
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceCodeMap";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceCodeMap" FOR EACH ROW EXECUTE FUNCTION atlas_audit();

-- The mappings already made (from punches stamped before this table existed),
-- so codes mapped today - Nishan Singh's "1" at Vcare - keep working.
INSERT INTO "AttendanceCodeMap" ("id", "storeId", "employeeCode", "userId", "mappedBy", "createdAt", "updatedAt")
SELECT 'acm_' || md5(p."storeId" || ':' || p."employeeCode"), p."storeId", p."employeeCode", MAX(p."userId"), 'backfill', NOW(), NOW()
FROM "AttendancePunch" p
WHERE p."userId" IS NOT NULL
GROUP BY p."storeId", p."employeeCode"
HAVING COUNT(DISTINCT p."userId") = 1
ON CONFLICT ("storeId", "employeeCode") DO NOTHING;
