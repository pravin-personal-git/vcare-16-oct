-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "AssetBatch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "totalQty" INTEGER NOT NULL,
    "unitCostPaise" INTEGER,
    "purchaseDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "fulfilledAssetId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetBatch_storeId_idx" ON "AssetBatch"("storeId");

-- CreateIndex
CREATE INDEX "AssetRequest_storeId_status_idx" ON "AssetRequest"("storeId", "status");

-- AddForeignKey
ALTER TABLE "AssetBatch" ADD CONSTRAINT "AssetBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AssetBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_fulfilledAssetId_fkey" FOREIGN KEY ("fulfilledAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
