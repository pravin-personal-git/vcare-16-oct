-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefix" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "barcode" TEXT,
    "sku" TEXT,
    "categoryId" TEXT,
    "subCategoryId" TEXT,
    "brandId" TEXT,
    "hsnCode" TEXT,
    "location" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "deliveryEstimateDays" INTEGER,
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "isRateEditable" BOOLEAN NOT NULL DEFAULT true,
    "isInOffer" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imagePath" TEXT,
    "specs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mrpPaise" INTEGER NOT NULL DEFAULT 0,
    "dlpPaise" INTEGER NOT NULL DEFAULT 0,
    "retailPaise" INTEGER NOT NULL DEFAULT 0,
    "wholesalePaise" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBalance" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "openingQty" INTEGER NOT NULL DEFAULT 0,
    "currentQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "inTransitQty" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,
    "lastMovementAt" TIMESTAMP(3),
    "lastSoldAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_storeId_idx" ON "Category"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_storeId_name_parentId_key" ON "Category"("storeId", "name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_storeId_name_key" ON "Brand"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_storeId_code_key" ON "Warehouse"("storeId", "code");

-- CreateIndex
CREATE INDEX "Product_storeId_isActive_idx" ON "Product"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "Product_storeId_categoryId_idx" ON "Product"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_productCode_key" ON "Product"("storeId", "productCode");

-- CreateIndex
CREATE INDEX "ProductPrice_productId_effectiveFrom_idx" ON "ProductPrice"("productId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductBalance_productId_idx" ON "ProductBalance"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBalance_productId_warehouseId_key" ON "ProductBalance"("productId", "warehouseId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBalance" ADD CONSTRAINT "ProductBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBalance" ADD CONSTRAINT "ProductBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
