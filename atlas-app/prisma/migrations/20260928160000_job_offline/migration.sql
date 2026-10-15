-- Workflow slice 8: offline step receipts (apply once).
CREATE TABLE "JobOfflineReceipt" (
  "id" TEXT NOT NULL,
  "opId" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "op" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobOfflineReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobOfflineReceipt_opId_key" ON "JobOfflineReceipt"("opId");
CREATE INDEX "JobOfflineReceipt_complaintId_idx" ON "JobOfflineReceipt"("complaintId");
