-- Pickup receipts (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 3): the
-- customer's own item taken away for repair, and the supplier case linked to
-- the complaint item it belongs to.
--
-- Expand-only: one new table, two nullable columns.
CREATE TABLE IF NOT EXISTS "ItemPickup" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "pickupNo" TEXT NOT NULL,
    "pickedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpBy" TEXT,
    "handedOverBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "ItemPickup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ItemPickup_storeId_pickupNo_key" ON "ItemPickup"("storeId", "pickupNo");
CREATE INDEX IF NOT EXISTS "ItemPickup_complaintId_idx" ON "ItemPickup"("complaintId");
DO $$ BEGIN
  ALTER TABLE "ItemPickup" ADD CONSTRAINT "ItemPickup_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ItemPickup" ADD CONSTRAINT "ItemPickup_complaintId_fkey"
    FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ComplaintItem" ADD COLUMN IF NOT EXISTS "pickupId" TEXT;
DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_pickupId_fkey"
    FOREIGN KEY ("pickupId") REFERENCES "ItemPickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "complaintItemId" TEXT;
DO $$ BEGIN
  ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_complaintItemId_fkey"
    FOREIGN KEY ("complaintItemId") REFERENCES "ComplaintItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who signed for a collected item is exactly what gets argued about later.
DROP TRIGGER IF EXISTS atlas_audit ON "ItemPickup";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ItemPickup" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
