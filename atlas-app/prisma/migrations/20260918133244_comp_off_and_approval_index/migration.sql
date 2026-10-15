-- AlterTable
ALTER TABLE "CompOffEntry" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedBy" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "requestedBy" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved';

-- CreateIndex
CREATE INDEX "ApprovalRequest_storeId_entityType_entityId_idx" ON "ApprovalRequest"("storeId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "CompOffEntry_storeId_status_idx" ON "CompOffEntry"("storeId", "status");
