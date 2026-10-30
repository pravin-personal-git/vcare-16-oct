-- Installations take a complaint's statuses (30 Oct 2026, Vcare): the stage
-- column now holds a lib/job-flow code, and the customer's sign-off code can
-- belong to an installation.
ALTER TABLE "JobOtp" ALTER COLUMN "complaintId" DROP NOT NULL;
ALTER TABLE "JobOtp" ADD COLUMN IF NOT EXISTS "installationChallanId" TEXT;
CREATE INDEX IF NOT EXISTS "JobOtp_installationChallanId_createdAt_idx" ON "JobOtp"("installationChallanId", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOtp_installationChallanId_fkey') THEN
    ALTER TABLE "JobOtp" ADD CONSTRAINT "JobOtp_installationChallanId_fkey"
      FOREIGN KEY ("installationChallanId") REFERENCES "InstallationChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "InstallationChallan" ALTER COLUMN "stage" SET DEFAULT 'received';

-- Old stages -> job statuses (lib/installation-stages OLD). Old Work done was
-- waiting for its bill, so it reads Waiting to close.
UPDATE "InstallationChallan" SET "stage" = CASE "stage"
  WHEN 'raised' THEN 'received' WHEN 'planned' THEN 'received'
  WHEN 'technician' THEN 'assigned' WHEN 'survey' THEN 'assigned'
  WHEN 'visit' THEN 'scheduled'
  WHEN 'fitting' THEN 'on_site' WHEN 'material_ready' THEN 'on_site' WHEN 'installing' THEN 'on_site'
  WHEN 'work_done' THEN 'resolved' WHEN 'testing' THEN 'resolved' WHEN 'handover' THEN 'resolved' WHEN 'approved' THEN 'resolved'
  WHEN 'billed' THEN 'closed'
  ELSE "stage" END
WHERE "stage" IN ('raised','planned','technician','survey','visit','fitting','material_ready','installing','work_done','testing','handover','approved','billed');
