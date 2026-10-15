-- Phase 5 and 6: customer sites, and the replacement (RMA) tracker.
-- General to any tenant. The Vcare data for both is a separate, generated
-- migration.

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "PartySite" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "mapLink" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "legacyRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementCase" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "legacyRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "brandModel" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "serialNo" TEXT,
    "stockUnitId" TEXT,
    "customerId" TEXT,
    "complaintId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "serviceCentre" TEXT,
    "courier" TEXT,
    "docketNo" TEXT,
    "sentAt" TIMESTAMP(3),
    "expectedBackAt" TIMESTAMP(3),
    "receivedBackAt" TIMESTAMP(3),
    "returnedToCustomerAt" TIMESTAMP(3),
    "outcome" TEXT,
    "replacementSerialNo" TEXT,
    "parentCaseId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplacementCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplacementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartySite_storeId_partyId_idx" ON "PartySite"("storeId", "partyId");

-- CreateIndex
CREATE INDEX "ReplacementCase_storeId_status_idx" ON "ReplacementCase"("storeId", "status");

-- CreateIndex
CREATE INDEX "ReplacementCase_storeId_docketNo_idx" ON "ReplacementCase"("storeId", "docketNo");

-- CreateIndex
CREATE INDEX "ReplacementCase_stockUnitId_idx" ON "ReplacementCase"("stockUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplacementCase_storeId_caseNo_key" ON "ReplacementCase"("storeId", "caseNo");

-- CreateIndex
CREATE INDEX "ReplacementEvent_caseId_createdAt_idx" ON "ReplacementEvent"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PartySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartySite" ADD CONSTRAINT "PartySite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartySite" ADD CONSTRAINT "PartySite_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_stockUnitId_fkey" FOREIGN KEY ("stockUnitId") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_parentCaseId_fkey" FOREIGN KEY ("parentCaseId") REFERENCES "ReplacementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementEvent" ADD CONSTRAINT "ReplacementEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementEvent" ADD CONSTRAINT "ReplacementEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReplacementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- "Replacements" in the sidebar, under the same parent as Customer Complaints
-- and with exactly its visibility: whoever runs the service desk chases the
-- faulty units. All three tiers, because a missing RoleMenuConfig row
-- resolves to false.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform)
SELECT gen_random_uuid()::text, p."parentId", 'Replacements', '/services/replacements', 'rotate-ccw',
       COALESCE((SELECT max(m.sort) FROM "Menu" m WHERE m."parentId" = p."parentId"), 0) + 1, 'WEB'::"Platform"
  FROM "Menu" p
 WHERE p.route = '/services/complaints'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/services/replacements')
 LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT sc."storeId", nw.id, sc."isEnabled"
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/services/complaints'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/replacements'
   AND NOT EXISTS (SELECT 1 FROM "StoreMenuConfig" x WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible"
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/services/complaints'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/replacements'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
