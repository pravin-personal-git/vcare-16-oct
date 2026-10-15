-- Field-job engine, slice 1 (workflow spec, 27-28 Sep 2026).

ALTER TABLE "Complaint"
  ADD COLUMN "jobType" TEXT NOT NULL DEFAULT 'complaint',
  ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'not_billable',
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "declinedReason" TEXT,
  ADD COLUMN "closedBy" TEXT,
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "JobSettings" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobSettings_storeId_key" ON "JobSettings"("storeId");
ALTER TABLE "JobSettings" ADD CONSTRAINT "JobSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP TRIGGER IF EXISTS atlas_audit ON "JobSettings";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobSettings" FOR EACH ROW EXECUTE FUNCTION atlas_audit();

-- "assigned" now means "waiting for the technician to accept". Jobs already
-- assigned before the engine existed are treated as accepted - nobody is asked
-- again. The old value is kept in customFields.legacyStatus (reversible).
UPDATE "Complaint"
SET "customFields" = COALESCE("customFields", '{}'::jsonb) || jsonb_build_object('legacyStatus', "status"),
    "status" = 'accepted',
    "acceptedAt" = COALESCE("assignedAt", "createdAt")
WHERE "status" = 'assigned';

-- Challans, check-ins and bare assignments were shown on customers' timelines
-- (logActivity defaulted to visible). They are internal.
UPDATE "ComplaintActivity" SET "visibleToPortal" = false
WHERE "kind" IN ('challan_created', 'field_check_in', 'assignment');
