-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "legacyRef" TEXT,
ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "legacyRef" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "legacyRef" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "legacyRef" TEXT;

-- AlterTable
ALTER TABLE "RepairChallan" ADD COLUMN     "legacyRef" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "legacyRef" TEXT;

-- CreateIndex
CREATE INDEX "Complaint_storeId_ownerId_idx" ON "Complaint"("storeId", "ownerId");

-- CreateIndex
CREATE INDEX "Complaint_storeId_legacyRef_idx" ON "Complaint"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "Invoice_storeId_legacyRef_idx" ON "Invoice"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "Quotation_storeId_legacyRef_idx" ON "Quotation"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "RepairChallan_storeId_legacyRef_idx" ON "RepairChallan"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "SalesOrder_storeId_legacyRef_idx" ON "SalesOrder"("storeId", "legacyRef");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
