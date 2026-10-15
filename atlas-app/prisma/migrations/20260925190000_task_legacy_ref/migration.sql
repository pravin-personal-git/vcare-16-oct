-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "legacyRef" TEXT;

-- CreateIndex
CREATE INDEX "Task_storeId_legacyRef_idx" ON "Task"("storeId", "legacyRef");

