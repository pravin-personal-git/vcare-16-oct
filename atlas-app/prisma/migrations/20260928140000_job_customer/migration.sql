-- Workflow slice 5: customer link, rating, estimates.

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "customerToken" TEXT,
ADD COLUMN     "ratedAt" TIMESTAMP(3),
ADD COLUMN     "ratingComment" TEXT,
ADD COLUMN     "ratingStars" INTEGER;

-- CreateTable
CREATE TABLE "JobEstimate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "decidedVia" TEXT,
    "decidedAt" TIMESTAMP(3),
    "declineNote" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobEstimate_storeId_status_idx" ON "JobEstimate"("storeId", "status");

-- CreateIndex
CREATE INDEX "JobEstimate_complaintId_idx" ON "JobEstimate"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_customerToken_key" ON "Complaint"("customerToken");

-- AddForeignKey
ALTER TABLE "JobEstimate" ADD CONSTRAINT "JobEstimate_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS atlas_audit ON "JobEstimate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobEstimate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
