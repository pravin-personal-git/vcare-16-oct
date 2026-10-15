-- Saved list layouts (F1 UI standard, 26 Sep 2026). Expand-only.
-- NOTE: prisma migrate diff also proposes DROP INDEX "RepairChallan_assigneeIds_idx".
-- That GIN index is hand-made (20260926010000) and must stay; it is left out on purpose.

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "screenKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "hiddenColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedRoleName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_userId_screenKey_idx" ON "SavedView"("userId", "screenKey");

-- CreateIndex
CREATE INDEX "SavedView_organizationId_screenKey_sharedRoleName_idx" ON "SavedView"("organizationId", "screenKey", "sharedRoleName");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit trail, like every business table (audit-coverage.test.ts).
DROP TRIGGER IF EXISTS atlas_audit ON "SavedView";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SavedView" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
