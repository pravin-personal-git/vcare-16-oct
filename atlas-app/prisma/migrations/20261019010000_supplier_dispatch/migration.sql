-- Supplier dispatches (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 4): one box
-- to one supplier carrying many supplier cases - courier, docket, tracking
-- link, courier charge, delivery challan number. Plus the menu item.
--
-- Expand-only: one new table, two nullable columns, one menu row.
CREATE TABLE IF NOT EXISTS "SupplierDispatch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dispatchNo" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "serviceCentre" TEXT,
    "supplierRmaNo" TEXT,
    "courier" TEXT,
    "docketNo" TEXT,
    "trackingUrl" TEXT,
    "courierChargePaise" INTEGER NOT NULL DEFAULT 0,
    "courierPaidBy" TEXT NOT NULL DEFAULT 'none',
    "chargeSplit" TEXT NOT NULL DEFAULT 'equal',
    "boxes" INTEGER,
    "weightKg" DECIMAL(8,2),
    "journalEntryId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedBackAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'sent',
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "SupplierDispatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierDispatch_storeId_dispatchNo_key" ON "SupplierDispatch"("storeId", "dispatchNo");
CREATE INDEX IF NOT EXISTS "SupplierDispatch_storeId_status_idx" ON "SupplierDispatch"("storeId", "status");
CREATE INDEX IF NOT EXISTS "SupplierDispatch_storeId_docketNo_idx" ON "SupplierDispatch"("storeId", "docketNo");
DO $$ BEGIN
  ALTER TABLE "SupplierDispatch" ADD CONSTRAINT "SupplierDispatch_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierDispatch" ADD CONSTRAINT "SupplierDispatch_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "dispatchId" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "courierSharePaise" INTEGER;
DO $$ BEGIN
  ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_dispatchId_fkey"
    FOREIGN KEY ("dispatchId") REFERENCES "SupplierDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ReplacementCase_dispatchId_idx" ON "ReplacementCase"("dispatchId");

-- What a courier cost and who paid it is money; it is audited.
DROP TRIGGER IF EXISTS atlas_audit ON "SupplierDispatch";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SupplierDispatch" FOR EACH ROW EXECUTE FUNCTION atlas_audit();

-- The menu item, beside Repairs & Replacements, visible wherever that one is.
INSERT INTO "Menu" (id, "parentId", label, route, icon, sort, platform, "updatedAt")
SELECT gen_random_uuid()::text, p."parentId", 'Supplier Dispatch', '/services/dispatch', 'truck', p.sort, 'WEB'::"Platform", CURRENT_TIMESTAMP
  FROM "Menu" p
 WHERE p.route = '/services/replacements'
   AND NOT EXISTS (SELECT 1 FROM "Menu" x WHERE x.route = '/services/dispatch')
 LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled", "updatedAt")
SELECT sc."storeId", nw.id, sc."isEnabled", CURRENT_TIMESTAMP
  FROM "StoreMenuConfig" sc
  JOIN "Menu" sib ON sib.id = sc."menuId" AND sib.route = '/services/replacements'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/dispatch'
   AND NOT EXISTS (SELECT 1 FROM "StoreMenuConfig" x WHERE x."storeId" = sc."storeId" AND x."menuId" = nw.id);

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible", "updatedAt")
SELECT rc."storeId", rc."roleId", nw.id, rc."isVisible", CURRENT_TIMESTAMP
  FROM "RoleMenuConfig" rc
  JOIN "Menu" sib ON sib.id = rc."menuId" AND sib.route = '/services/replacements'
 CROSS JOIN "Menu" nw
 WHERE nw.route = '/services/dispatch'
   AND NOT EXISTS (
     SELECT 1 FROM "RoleMenuConfig" x
      WHERE x."storeId" = rc."storeId" AND x."roleId" = rc."roleId" AND x."menuId" = nw.id);
