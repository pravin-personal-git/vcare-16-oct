-- Phase 4: AMC as a contract.
--
-- Generated with prisma migrate diff rather than migrate dev, because the
-- shadow-database replay fails on 20260923201500_vcare_staff_attribution_and_challans:
-- that generated data migration resolves storeId from a subselect that returns
-- null on an empty database, so it cannot be replayed from scratch. Recorded in
-- 09-documentation/04-roadmap/VCARE-CLIENT-FINDINGS.md - it will block every
-- future migrate dev until fixed.
--
-- Structure only. No data: the Vcare import carried exactly one AMC-shaped
-- record (a single "ANNUAL MAINTENANCE CHARGES" invoice line, Rs 24,000), so
-- there is nothing to backfill. This module starts empty by design.
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "warrantyMonths" INTEGER;

-- CreateTable
CREATE TABLE "AmcContract" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "legacyRef" TEXT,
    "customerId" TEXT NOT NULL,
    "siteLabel" TEXT,
    "invoiceId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "coverageTerms" TEXT NOT NULL DEFAULT 'labour_only',
    "visitsIncluded" INTEGER,
    "reminderDays" INTEGER NOT NULL DEFAULT 30,
    "renewedFromId" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmcContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmcContractItem" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "serialNo" TEXT,
    "srNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmcContractItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmcContract_storeId_status_idx" ON "AmcContract"("storeId", "status");

-- CreateIndex
CREATE INDEX "AmcContract_storeId_customerId_idx" ON "AmcContract"("storeId", "customerId");

-- CreateIndex
CREATE INDEX "AmcContract_storeId_endDate_idx" ON "AmcContract"("storeId", "endDate");

-- CreateIndex
CREATE INDEX "AmcContract_storeId_legacyRef_idx" ON "AmcContract"("storeId", "legacyRef");

-- CreateIndex
CREATE UNIQUE INDEX "AmcContract_storeId_contractNo_key" ON "AmcContract"("storeId", "contractNo");

-- CreateIndex
CREATE INDEX "AmcContractItem_contractId_idx" ON "AmcContractItem"("contractId");

-- CreateIndex
CREATE INDEX "AmcContractItem_productId_idx" ON "AmcContractItem"("productId");

-- CreateIndex
CREATE INDEX "AmcContractItem_serialNo_idx" ON "AmcContractItem"("serialNo");

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "AmcContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContractItem" ADD CONSTRAINT "AmcContractItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "AmcContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContractItem" ADD CONSTRAINT "AmcContractItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

