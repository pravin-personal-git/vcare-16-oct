-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "gstin" TEXT,
    "stateId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "itemDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableBasePaise" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "grandTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "taxMode" TEXT NOT NULL DEFAULT 'IGST',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "lineDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "lineTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_storeId_status_idx" ON "PurchaseOrder"("storeId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_storeId_orderDate_idx" ON "PurchaseOrder"("storeId", "orderDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_storeId_partyId_idx" ON "PurchaseOrder"("storeId", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_storeId_orderNo_key" ON "PurchaseOrder"("storeId", "orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_storeId_productId_idx" ON "PurchaseOrderItem"("storeId", "productId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
