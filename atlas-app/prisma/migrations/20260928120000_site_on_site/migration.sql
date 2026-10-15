-- Workflow slice 3: time on site and location-check overrides.
ALTER TABLE "Complaint"
  ADD COLUMN "onSiteSince" TIMESTAMP(3),
  ADD COLUMN "timeOnSiteSec" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overrideUsed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SiteOverride" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "lat" DECIMAL(9,6),
  "lng" DECIMAL(9,6),
  "accuracyM" INTEGER,
  "distanceM" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteOverride_storeId_status_idx" ON "SiteOverride"("storeId", "status");
CREATE INDEX "SiteOverride_complaintId_idx" ON "SiteOverride"("complaintId");
ALTER TABLE "SiteOverride" ADD CONSTRAINT "SiteOverride_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP TRIGGER IF EXISTS atlas_audit ON "SiteOverride";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SiteOverride" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
