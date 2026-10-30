-- The customer's saved site on an installation challan and a survey visit (30 Oct 2026, Vcare).
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
CREATE INDEX IF NOT EXISTS "InstallationChallan_siteId_idx" ON "InstallationChallan"("siteId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InstallationChallan_siteId_fkey') THEN
    ALTER TABLE "InstallationChallan" ADD CONSTRAINT "InstallationChallan_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "PartySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_siteId_fkey') THEN
    ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "PartySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
