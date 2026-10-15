-- CreateTable
CREATE TABLE "GoodsReceiptNote" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grnNo" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "partyId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceBillId" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptNoteItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "srNo" INTEGER NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,

    CONSTRAINT "GoodsReceiptNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_storeId_status_idx" ON "GoodsReceiptNote"("storeId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_storeId_receivedDate_idx" ON "GoodsReceiptNote"("storeId", "receivedDate");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_storeId_purchaseOrderId_idx" ON "GoodsReceiptNote"("storeId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptNote_storeId_grnNo_key" ON "GoodsReceiptNote"("storeId", "grnNo");

-- CreateIndex
CREATE INDEX "GoodsReceiptNoteItem_grnId_idx" ON "GoodsReceiptNoteItem"("grnId");

-- CreateIndex
CREATE INDEX "GoodsReceiptNoteItem_storeId_productId_idx" ON "GoodsReceiptNoteItem"("storeId", "productId");

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNoteItem" ADD CONSTRAINT "GoodsReceiptNoteItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNoteItem" ADD CONSTRAINT "GoodsReceiptNoteItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceiptNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
