-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'goods',
ADD COLUMN     "sacCode" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "costMethod" TEXT NOT NULL DEFAULT 'last_purchase';

-- CreateTable
CREATE TABLE "ProductPurchasePrice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPurchasePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPurchasePrice_storeId_productId_purchasedAt_idx" ON "ProductPurchasePrice"("storeId", "productId", "purchasedAt");

-- CreateIndex
CREATE INDEX "Product_storeId_kind_idx" ON "Product"("storeId", "kind");

-- AddForeignKey
ALTER TABLE "ProductPurchasePrice" ADD CONSTRAINT "ProductPurchasePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
