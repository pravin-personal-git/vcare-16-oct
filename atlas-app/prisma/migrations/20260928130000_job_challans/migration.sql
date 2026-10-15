-- Workflow slice 4: job challans, material issues (GDN), faulty parts.

-- CreateTable
CREATE TABLE "JobChallan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'material',
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "JobChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobChallanLine" (
    "id" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "qtyIssued" INTEGER NOT NULL DEFAULT 0,
    "qtyReturned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobChallanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "gdnNo" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaultyPartReturn" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "serialNo" TEXT,
    "loggedBy" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "FaultyPartReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobChallan_storeId_status_idx" ON "JobChallan"("storeId", "status");

-- CreateIndex
CREATE INDEX "JobChallan_complaintId_idx" ON "JobChallan"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "JobChallan_storeId_challanNo_key" ON "JobChallan"("storeId", "challanNo");

-- CreateIndex
CREATE INDEX "JobChallanLine_challanId_idx" ON "JobChallanLine"("challanId");

-- CreateIndex
CREATE INDEX "MaterialIssue_challanId_idx" ON "MaterialIssue"("challanId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIssue_storeId_gdnNo_key" ON "MaterialIssue"("storeId", "gdnNo");

-- CreateIndex
CREATE INDEX "FaultyPartReturn_storeId_receivedAt_idx" ON "FaultyPartReturn"("storeId", "receivedAt");

-- CreateIndex
CREATE INDEX "FaultyPartReturn_complaintId_idx" ON "FaultyPartReturn"("complaintId");

-- AddForeignKey
ALTER TABLE "JobChallan" ADD CONSTRAINT "JobChallan_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobChallanLine" ADD CONSTRAINT "JobChallanLine_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "JobChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobChallanLine" ADD CONSTRAINT "JobChallanLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "JobChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaultyPartReturn" ADD CONSTRAINT "FaultyPartReturn_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaultyPartReturn" ADD CONSTRAINT "FaultyPartReturn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS atlas_audit ON "JobChallan";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobChallan" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "JobChallanLine";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobChallanLine" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "MaterialIssue";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "MaterialIssue" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "FaultyPartReturn";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "FaultyPartReturn" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
