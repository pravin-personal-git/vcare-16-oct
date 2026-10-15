-- AlterTable
ALTER TABLE "RepairChallan" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "physicalChallanNo" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "technicianRemark" TEXT;

-- CreateTable
CREATE TABLE "InstallationChallan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "legacyRef" TEXT,
    "salesOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "physicalChallanNo" TEXT,
    "technicianRemark" TEXT,
    "note" TEXT,
    "termsBody" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationChallanItem" (
    "id" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "barcode" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "srNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationChallanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationChallanAssignee" (
    "challanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationChallanAssignee_pkey" PRIMARY KEY ("challanId","userId")
);

-- CreateIndex
CREATE INDEX "InstallationChallan_storeId_status_idx" ON "InstallationChallan"("storeId", "status");

-- CreateIndex
CREATE INDEX "InstallationChallan_storeId_salesOrderId_idx" ON "InstallationChallan"("storeId", "salesOrderId");

-- CreateIndex
CREATE INDEX "InstallationChallan_storeId_legacyRef_idx" ON "InstallationChallan"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "InstallationChallan_storeId_physicalChallanNo_idx" ON "InstallationChallan"("storeId", "physicalChallanNo");

-- CreateIndex
CREATE UNIQUE INDEX "InstallationChallan_storeId_challanNo_key" ON "InstallationChallan"("storeId", "challanNo");

-- CreateIndex
CREATE INDEX "InstallationChallanItem_challanId_idx" ON "InstallationChallanItem"("challanId");

-- CreateIndex
CREATE INDEX "InstallationChallanItem_barcode_idx" ON "InstallationChallanItem"("barcode");

-- CreateIndex
CREATE INDEX "InstallationChallanAssignee_userId_idx" ON "InstallationChallanAssignee"("userId");

-- CreateIndex
CREATE INDEX "RepairChallan_storeId_status_idx" ON "RepairChallan"("storeId", "status");

-- CreateIndex
CREATE INDEX "RepairChallan_storeId_physicalChallanNo_idx" ON "RepairChallan"("storeId", "physicalChallanNo");

-- AddForeignKey
ALTER TABLE "InstallationChallan" ADD CONSTRAINT "InstallationChallan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationChallan" ADD CONSTRAINT "InstallationChallan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationChallanItem" ADD CONSTRAINT "InstallationChallanItem_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "InstallationChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationChallanItem" ADD CONSTRAINT "InstallationChallanItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationChallanAssignee" ADD CONSTRAINT "InstallationChallanAssignee_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "InstallationChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationChallanAssignee" ADD CONSTRAINT "InstallationChallanAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
