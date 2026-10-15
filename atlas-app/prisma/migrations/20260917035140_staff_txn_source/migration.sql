-- AlterTable
ALTER TABLE "StaffTransaction" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateIndex
CREATE INDEX "StaffTransaction_storeId_sourceType_sourceId_idx" ON "StaffTransaction"("storeId", "sourceType", "sourceId");
