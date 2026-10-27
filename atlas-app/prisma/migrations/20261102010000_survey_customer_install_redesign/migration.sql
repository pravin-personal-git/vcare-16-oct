-- Survey visit without a challan, and the installation job rebuilt like a
-- complaint (27 Oct 2026, Vcare). Idempotent: safe to run twice.

-- ===========================================================================
-- 1. A SURVEY VISIT HANGS OFF THE CUSTOMER
-- ===========================================================================
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "siteAddress" TEXT;
CREATE INDEX IF NOT EXISTS "ServiceVisit_customerId_idx" ON "ServiceVisit"("customerId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_customerId_fkey') THEN
    ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A visit is about a complaint or a challan - or, for a survey only, just a
-- customer. Still never both a complaint and a challan.
ALTER TABLE "ServiceVisit" DROP CONSTRAINT IF EXISTS "ServiceVisit_one_subject";
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_one_subject" CHECK (
  (("complaintId" IS NOT NULL) <> ("installationChallanId" IS NOT NULL))
  OR ("reason" = 'installation_survey' AND "complaintId" IS NULL AND "installationChallanId" IS NULL AND "customerId" IS NOT NULL)
);

-- ===========================================================================
-- 2. THE CUSTOMER ON THE INSTALLATION CHALLAN
-- ===========================================================================
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "notBilledReason" TEXT;
CREATE INDEX IF NOT EXISTS "InstallationChallan_storeId_customerId_idx" ON "InstallationChallan"("storeId", "customerId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InstallationChallan_customerId_fkey') THEN
    ALTER TABLE "InstallationChallan" ADD CONSTRAINT "InstallationChallan_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The challans before today get their order's customer.
UPDATE "InstallationChallan" c
SET "customerId" = o."partyId"
FROM "SalesOrder" o
WHERE c."salesOrderId" = o."id" AND c."customerId" IS NULL AND o."partyId" IS NOT NULL;

-- ===========================================================================
-- 3. SIX STAGES THAT MOVE BY THEMSELVES
--    raised -> technician -> visit -> fitting -> work_done -> billed
--    (lib/installation-stages.ts `deriveStage` is the same rule in code)
-- ===========================================================================
ALTER TABLE "InstallationChallan" ALTER COLUMN "stage" SET DEFAULT 'raised';

UPDATE "InstallationChallan" c SET "stage" = CASE
  WHEN c."isInvoiced" OR c."notBilledReason" IS NOT NULL THEN 'billed'
  WHEN c."status" IN ('work_done', 'approved') THEN 'work_done'
  WHEN c."stage" IN ('testing', 'handover') AND c."status" <> 'rejected' THEN 'work_done'
  WHEN EXISTS (SELECT 1 FROM "InstallationChallanItem" i WHERE i."challanId" = c."id" AND i."fitStatus" IN ('fitted', 'tested'))
    OR EXISTS (SELECT 1 FROM "ServiceVisit" v WHERE v."installationChallanId" = c."id" AND v."checkedInAt" IS NOT NULL)
    OR c."stage" IN ('material_ready', 'installing', 'testing', 'handover') THEN 'fitting'
  WHEN EXISTS (SELECT 1 FROM "ServiceVisit" v WHERE v."installationChallanId" = c."id" AND v."status" <> 'cancelled') THEN 'visit'
  WHEN EXISTS (SELECT 1 FROM "InstallationChallanAssignee" a WHERE a."challanId" = c."id") THEN 'technician'
  ELSE 'raised'
END
WHERE c."stage" NOT IN ('raised', 'technician', 'visit', 'fitting', 'work_done', 'billed');
