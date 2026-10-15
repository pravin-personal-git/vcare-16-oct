-- Hand back (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 6): the GDN a
-- complaint item went back to the customer on, and a unit's fresh warranty
-- start when a supplier's new serial (or a unit from our stock in place of one
-- the supplier kept) is handed over.
--
-- Expand-only: two nullable columns.
ALTER TABLE "ComplaintItem" ADD COLUMN IF NOT EXISTS "handbackIssueId" TEXT;
DO $$ BEGIN
  ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_handbackIssueId_fkey"
    FOREIGN KEY ("handbackIssueId") REFERENCES "MaterialIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ComplaintItem_handbackIssueId_idx" ON "ComplaintItem"("handbackIssueId");

ALTER TABLE "StockUnit" ADD COLUMN IF NOT EXISTS "warrantyFrom" TIMESTAMP(3);
