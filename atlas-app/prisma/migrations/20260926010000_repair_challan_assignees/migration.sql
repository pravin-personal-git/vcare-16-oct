-- AlterTable
ALTER TABLE "RepairChallan" ADD COLUMN     "assigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- "Assigned to me" lookups.
CREATE INDEX IF NOT EXISTS "RepairChallan_assigneeIds_idx" ON "RepairChallan" USING GIN ("assigneeIds");
