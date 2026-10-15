-- G-21 (10 Oct 2026): an installation raised from a sales order is now an
-- installation challan, not a complaint, so the challan carries the site the
-- office captured - its text and its pin. Expand-only: three nullable columns.
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "siteLocation" TEXT;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "siteLat" DECIMAL(9,6);
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "siteLng" DECIMAL(9,6);
