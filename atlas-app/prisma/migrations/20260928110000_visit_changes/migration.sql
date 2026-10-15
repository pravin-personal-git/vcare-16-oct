-- Workflow slice 2: visit reschedule trail.
CREATE TABLE "VisitChange" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "fromAt" TIMESTAMP(3) NOT NULL,
  "toAt" TIMESTAMP(3),
  "kind" TEXT NOT NULL DEFAULT 'reschedule',
  "reason" TEXT NOT NULL,
  "changedBy" TEXT,
  "requestedByCustomer" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitChange_visitId_createdAt_idx" ON "VisitChange"("visitId", "createdAt");
ALTER TABLE "VisitChange" ADD CONSTRAINT "VisitChange_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ServiceVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP TRIGGER IF EXISTS atlas_audit ON "VisitChange";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "VisitChange" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
