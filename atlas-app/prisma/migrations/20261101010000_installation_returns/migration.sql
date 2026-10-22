-- Unused goods back from an installation, and material challans on one.
-- Vcare feedback, 22 Oct 2026 (09-documentation/04-roadmap/TECHNICIAN-UNUSED-RETURNS-ROADMAP.md).
--
-- R2. An installation's goods leave on the sales order's dispatch (its GDN):
-- the whole order, every line, at once. Until now they could only come back
-- whole (order Returned or cancelled). A technician who fitted 8 of 10 cameras
-- had nowhere to say the other 2 came back, so stock, the bill and the cost
-- all stayed at 10.
--
--   InstallationChallanItem.qtyReturnPending  the technician says N are coming
--                                             back - a request, no stock moves
--   InstallationChallanItem.qtyReturned       the store received them
--   SalesOrderItem.returnedQty                the same, on the order line, so
--                                             the order's own return / cancel
--                                             / invoice count only what is
--                                             still out with the customer
--
-- R3. Cable, clamps and connectors are not lines on the order, so they never
-- left on its GDN. They go out on the complaint's challan engine instead
-- (raise -> approval -> store GDN -> unused back), so a JobChallan can now
-- belong to an installation: complaintId becomes optional and exactly one of
-- complaintId / installationChallanId is set (CHECK below, like ServiceVisit).
--
-- Expand-only: columns added, one NOT NULL relaxed, nothing dropped or
-- renamed, every existing row valid as it is. Safe to run twice. The tables
-- already carry their audit triggers.

-- ===========================================================================
-- R2. RETURNS ON AN INSTALLATION LINE AND ITS ORDER LINE
-- ===========================================================================
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "qtyReturnPending" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "qtyReturned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- ===========================================================================
-- R3. A JOB CHALLAN FOR AN INSTALLATION
-- ===========================================================================
ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "installationChallanId" TEXT;
ALTER TABLE "JobChallan" ALTER COLUMN "complaintId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JobChallan_installationChallanId_fkey'
  ) THEN
    ALTER TABLE "JobChallan"
      ADD CONSTRAINT "JobChallan_installationChallanId_fkey"
      FOREIGN KEY ("installationChallanId") REFERENCES "InstallationChallan"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "JobChallan_installationChallanId_idx"
  ON "JobChallan"("installationChallanId");

-- Every existing row has a complaint and no installation, so this holds today.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JobChallan_one_job_chk'
  ) THEN
    ALTER TABLE "JobChallan"
      ADD CONSTRAINT "JobChallan_one_job_chk"
      CHECK (("complaintId" IS NULL) <> ("installationChallanId" IS NULL));
  END IF;
END $$;
