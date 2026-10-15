-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "partyId" TEXT,
    "supplierName" TEXT NOT NULL,
    "gstin" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "warehouseId" TEXT,
    "notes" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
    "billItemId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "hsnCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "billLineQty" INTEGER NOT NULL,
    "billLineTaxablePaise" INTEGER NOT NULL,

    CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDebitNote" (
    "id" TEXT NOT NULL,
    "debitNoteNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "partyId" TEXT,
    "supplierName" TEXT NOT NULL,
    "gstin" TEXT,
    "debitNoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxableBasePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "grandTotalPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierDebitNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReturn_storeId_lifecycle_returnedAt_idx" ON "PurchaseReturn"("storeId", "lifecycle", "returnedAt");

-- CreateIndex
CREATE INDEX "PurchaseReturn_storeId_billId_idx" ON "PurchaseReturn"("storeId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_storeId_returnNo_key" ON "PurchaseReturn"("storeId", "returnNo");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_billItemId_idx" ON "PurchaseReturnItem"("billItemId");

-- CreateIndex
CREATE INDEX "SupplierDebitNote_storeId_lifecycle_debitNoteDate_idx" ON "SupplierDebitNote"("storeId", "lifecycle", "debitNoteDate");

-- CreateIndex
CREATE INDEX "SupplierDebitNote_storeId_billId_idx" ON "SupplierDebitNote"("storeId", "billId");

-- CreateIndex
CREATE INDEX "SupplierDebitNote_storeId_purchaseReturnId_idx" ON "SupplierDebitNote"("storeId", "purchaseReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierDebitNote_storeId_debitNoteNo_key" ON "SupplierDebitNote"("storeId", "debitNoteNo");

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PurchaseBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "PurchaseBillItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PurchaseBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
