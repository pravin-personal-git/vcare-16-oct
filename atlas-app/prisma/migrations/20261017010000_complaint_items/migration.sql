-- One row per item on a complaint (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC
-- stage 2): the exact serial (or what the customer says it is when we did not
-- sell it), and that item's own warranty-void request and decision.
--
-- Expand-only: a new table; nothing existing changes. Old complaints keep
-- their single Complaint.productId and simply have no items.
CREATE TABLE IF NOT EXISTS "ComplaintItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL DEFAULT 1,
    "ours" BOOLEAN NOT NULL DEFAULT true,
    "stockUnitId" TEXT,
    "productId" TEXT,
    "equipmentName" TEXT NOT NULL,
    "serialNo" TEXT,
    "problem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "cancelReason" TEXT,
    "voidStatus" TEXT,
    "voidReason" TEXT,
    "voidPhotoId" TEXT,
    "voidRequestedBy" TEXT,
    "voidRequestedAt" TIMESTAMP(3),
    "voidDecidedBy" TEXT,
    "voidDecidedAt" TIMESTAMP(3),
    "voidDecisionNote" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "ComplaintItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ComplaintItem_complaintId_idx" ON "ComplaintItem"("complaintId");
CREATE INDEX IF NOT EXISTS "ComplaintItem_storeId_stockUnitId_idx" ON "ComplaintItem"("storeId", "stockUnitId");
CREATE INDEX IF NOT EXISTS "ComplaintItem_storeId_voidStatus_idx" ON "ComplaintItem"("storeId", "voidStatus");

DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_complaintId_fkey"
    FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_stockUnitId_fkey"
    FOREIGN KEY ("stockUnitId") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who asked to void a warranty, and who approved it, is argued about later.
DROP TRIGGER IF EXISTS atlas_audit ON "ComplaintItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ComplaintItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
