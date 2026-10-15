-- Installations get their own page (11 Oct 2026, ops-pages demo tab 1).
-- Expand-only: nullable columns and columns with defaults; nothing removed.
--
-- The challan carries its working stage (planned -> survey -> material_ready
-- -> installing -> testing -> handover -> approved) beside the existing
-- approval `status`, which the phone app and the approval rules keep using.
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "surveyJson" JSONB;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "testingJson" JSONB;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "materialsJson" JSONB;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "handoverAt" TIMESTAMP(3);
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "handoverTo" TEXT;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "handoverBy" TEXT;

-- Each line: which order line it fits (so one order can have several
-- installations without fitting a line twice), where on site it goes, the
-- serial scanned there, and whether it is fitted / tested.
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "salesOrderItemId" TEXT;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "placement" TEXT;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "serialNo" TEXT;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "fitStatus" TEXT NOT NULL DEFAULT 'to_fit';
CREATE INDEX IF NOT EXISTS "InstallationChallanItem_salesOrderItemId_idx" ON "InstallationChallanItem"("salesOrderItemId");

-- Old challans already approved count as handed over and fitted.
UPDATE "InstallationChallan" SET "stage" = 'approved' WHERE "status" = 'approved' AND "stage" = 'planned';
UPDATE "InstallationChallan" SET "stage" = 'handover' WHERE "status" = 'work_done' AND "stage" = 'planned';
UPDATE "InstallationChallanItem" i SET "fitStatus" = 'tested'
  FROM "InstallationChallan" c WHERE i."challanId" = c."id" AND c."status" = 'approved' AND i."fitStatus" = 'to_fit';
