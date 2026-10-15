-- CreateTable
CREATE TABLE "BillOfMaterials" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "finishedProductId" TEXT NOT NULL,
    "outputQty" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillOfMaterials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomComponent" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "BomComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "qtyToProduce" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "warehouseId" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillOfMaterials_storeId_finishedProductId_idx" ON "BillOfMaterials"("storeId", "finishedProductId");

-- CreateIndex
CREATE INDEX "BomComponent_bomId_idx" ON "BomComponent"("bomId");

-- CreateIndex
CREATE INDEX "ProductionOrder_storeId_status_createdAt_idx" ON "ProductionOrder"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_storeId_orderNo_key" ON "ProductionOrder"("storeId", "orderNo");

-- AddForeignKey
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
