-- Workflow slice 6: sign-off code, call-back flag.

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "needsCallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signOff" TEXT;

-- CreateTable
CREATE TABLE "JobOtp" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOtp_complaintId_createdAt_idx" ON "JobOtp"("complaintId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobOtp" ADD CONSTRAINT "JobOtp_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS atlas_audit ON "JobOtp";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobOtp" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
