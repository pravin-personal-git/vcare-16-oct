-- CreateTable
CREATE TABLE "ComplaintFieldConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ComplaintFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "raisedByPortal" BOOLEAN NOT NULL DEFAULT false,
    "siteLocation" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "resolutionType" TEXT,
    "assignedTechnicianId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "customFields" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintActivity" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "outcomeNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairChallan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairChallan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplaintFieldConfig_storeId_sortOrder_idx" ON "ComplaintFieldConfig"("storeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintFieldConfig_storeId_fieldKey_key" ON "ComplaintFieldConfig"("storeId", "fieldKey");

-- CreateIndex
CREATE INDEX "Complaint_storeId_status_idx" ON "Complaint"("storeId", "status");

-- CreateIndex
CREATE INDEX "Complaint_storeId_customerId_idx" ON "Complaint"("storeId", "customerId");

-- CreateIndex
CREATE INDEX "Complaint_storeId_assignedTechnicianId_idx" ON "Complaint"("storeId", "assignedTechnicianId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_storeId_complaintNo_key" ON "Complaint"("storeId", "complaintNo");

-- CreateIndex
CREATE INDEX "ComplaintActivity_complaintId_createdAt_idx" ON "ComplaintActivity"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceVisit_complaintId_idx" ON "ServiceVisit"("complaintId");

-- CreateIndex
CREATE INDEX "ServiceVisit_technicianId_scheduledAt_idx" ON "ServiceVisit"("technicianId", "scheduledAt");

-- CreateIndex
CREATE INDEX "RepairChallan_storeId_idx" ON "RepairChallan"("storeId");

-- CreateIndex
CREATE INDEX "RepairChallan_complaintId_idx" ON "RepairChallan"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "RepairChallan_storeId_challanNo_key" ON "RepairChallan"("storeId", "challanNo");

-- AddForeignKey
ALTER TABLE "ComplaintFieldConfig" ADD CONSTRAINT "ComplaintFieldConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_assignedTechnicianId_fkey" FOREIGN KEY ("assignedTechnicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintActivity" ADD CONSTRAINT "ComplaintActivity_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairChallan" ADD CONSTRAINT "RepairChallan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairChallan" ADD CONSTRAINT "RepairChallan_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairChallan" ADD CONSTRAINT "RepairChallan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
