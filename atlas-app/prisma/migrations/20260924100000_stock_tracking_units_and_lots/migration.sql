-- Phase 3: serialised and batch stock, as a general capability of the product.
--
-- Nothing in here is specific to any tenant. How closely a product's stock is
-- tracked becomes a property of the PRODUCT (`Product.trackingMode`), and two
-- new tables hold what the two finer modes need: `StockLot` for batch, and
-- `StockUnit` (plus its history, `StockUnitEvent`) for serial. Extra per-unit
-- attributes are configuration (`StockFieldConfig`), not columns.
--
-- The Vcare data migration is NOT in this file. It is generated separately,
-- printed and reviewed before anything is written - see
-- scratch/vcare-phase3-plan.mjs.

-- AlterTable
ALTER TABLE "GoodsReceiptNote" ADD COLUMN     "legacyRef" TEXT,
ADD COLUMN     "supplierInvoiceNo" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "isRefurbished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lotNo" TEXT,
ADD COLUMN     "mfgDate" TIMESTAMP(3),
ADD COLUMN     "taxRatePct" DECIMAL(5,2),
ADD COLUMN     "warrantyMonths" INTEGER;

-- AlterTable
ALTER TABLE "InstallationChallanItem" ADD COLUMN     "stockUnitId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "trackingMode" TEXT NOT NULL DEFAULT 'quantity';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "stockUnitId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "warrantyStartsOn" TEXT NOT NULL DEFAULT 'invoice';

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "grnItemId" TEXT,
    "unitCostPaise" INTEGER,
    "mfgDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockUnit" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serialNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "condition" TEXT NOT NULL DEFAULT 'new',
    "partyId" TEXT,
    "invoiceId" TEXT,
    "grnItemId" TEXT,
    "unitCostPaise" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "warrantyMonths" INTEGER,
    "customFields" JSONB,
    "legacyRef" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockUnitEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromCondition" TEXT,
    "toCondition" TEXT,
    "partyId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockUnitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockFieldConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLot_storeId_expiryDate_idx" ON "StockLot"("storeId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_storeId_productId_lotNo_key" ON "StockLot"("storeId", "productId", "lotNo");

-- CreateIndex
CREATE INDEX "StockUnit_storeId_serialNo_idx" ON "StockUnit"("storeId", "serialNo");

-- CreateIndex
CREATE INDEX "StockUnit_storeId_status_idx" ON "StockUnit"("storeId", "status");

-- CreateIndex
CREATE INDEX "StockUnit_storeId_productId_status_idx" ON "StockUnit"("storeId", "productId", "status");

-- CreateIndex
CREATE INDEX "StockUnit_partyId_idx" ON "StockUnit"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockUnit_storeId_productId_serialNo_key" ON "StockUnit"("storeId", "productId", "serialNo");

-- CreateIndex
CREATE INDEX "StockUnitEvent_unitId_createdAt_idx" ON "StockUnitEvent"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "StockUnitEvent_storeId_createdAt_idx" ON "StockUnitEvent"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StockFieldConfig_storeId_sortOrder_idx" ON "StockFieldConfig"("storeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StockFieldConfig_storeId_fieldKey_key" ON "StockFieldConfig"("storeId", "fieldKey");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_storeId_legacyRef_idx" ON "GoodsReceiptNote"("storeId", "legacyRef");

-- CreateIndex
CREATE INDEX "InstallationChallanItem_stockUnitId_idx" ON "InstallationChallanItem"("stockUnitId");

-- CreateIndex
CREATE INDEX "Product_storeId_trackingMode_idx" ON "Product"("storeId", "trackingMode");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- CreateIndex
CREATE INDEX "StockMovement_stockUnitId_idx" ON "StockMovement"("stockUnitId");

-- AddForeignKey
ALTER TABLE "InstallationChallanItem" ADD CONSTRAINT "InstallationChallanItem_stockUnitId_fkey" FOREIGN KEY ("stockUnitId") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockUnitId_fkey" FOREIGN KEY ("stockUnitId") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_grnItemId_fkey" FOREIGN KEY ("grnItemId") REFERENCES "GoodsReceiptNoteItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_grnItemId_fkey" FOREIGN KEY ("grnItemId") REFERENCES "GoodsReceiptNoteItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnitEvent" ADD CONSTRAINT "StockUnitEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnitEvent" ADD CONSTRAINT "StockUnitEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "StockUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockFieldConfig" ADD CONSTRAINT "StockFieldConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockFieldConfig" ADD CONSTRAINT "StockFieldConfig_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A service never touches stock. Every product that is already a service
-- becomes `none`, so the rule in `applyMovements` ("no movement for a `none`
-- product") changes nothing for a product that was classified correctly - and
-- stops a labour line on an invoice from deducting "1 INSTALLATION" from a
-- shelf. Goods keep the column default, `quantity`, which is how every product
-- behaved before this column existed.
UPDATE "Product" SET "trackingMode" = 'none' WHERE kind = 'service' AND "trackingMode" <> 'none';

-- The screen, in the sidebar. `Menu` is global; a store sees it only through
-- StoreMenuConfig and RoleMenuConfig rows, and a MISSING RoleMenuConfig row
-- resolves to false - which is how all six Vcare roles once got a blank
-- sidebar. So all three tiers are written here, and the new item copies the
-- visibility of its nearest sibling, Goods Receipt Note: whoever receives stock
-- is who manages units. No tenant gets an item it had switched off, and no
-- per-tenant decision is made in a migration.

-- 1. The menu row, directly after Goods Receipt Note under the same parent.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, g."parentId", 'Serial & Batch Stock', '/stock-units', 'box',
       g.sort + 1, 'WEB'::"Platform"
  FROM "Menu" g
 WHERE g.route = '/goods-receipt'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/stock-units')
 LIMIT 1;

-- 2. Store level: enabled wherever Goods Receipt Note is.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/goods-receipt'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/stock-units'
   AND NOT EXISTS (
     SELECT 1 FROM "StoreMenuConfig" x WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

-- 3. Role level: the same mirror, per role per store.
INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/goods-receipt'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/stock-units'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
