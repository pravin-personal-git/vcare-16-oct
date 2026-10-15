-- Call logs.
--
-- Two new tables and one new column with a default. No ALTER that changes an
-- existing column's type or nullability, no DROP. Safe to apply while the
-- current version is serving.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "callCaptureMode" TEXT NOT NULL DEFAULT 'crm_only';

-- CreateTable
CREATE TABLE "CallSyncDevice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "deviceLabel" TEXT,
    "deviceModel" TEXT,
    "androidVersion" TEXT,
    "appVersion" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastCallAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSyncDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawNumber" TEXT NOT NULL,
    "e164Number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "matchedCrm" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallSyncDevice_tokenHash_key" ON "CallSyncDevice"("tokenHash");
CREATE UNIQUE INDEX "CallSyncDevice_pairingCode_key" ON "CallSyncDevice"("pairingCode");
CREATE INDEX "CallSyncDevice_storeId_isActive_idx" ON "CallSyncDevice"("storeId", "isActive");
CREATE INDEX "CallSyncDevice_userId_idx" ON "CallSyncDevice"("userId");
CREATE INDEX "CallSyncDevice_storeId_lastSyncedAt_idx" ON "CallSyncDevice"("storeId", "lastSyncedAt");

-- The dedupe guarantee. Scoped to the store rather than the device, so the same
-- call re-sent after a phone is re-paired does not become a second row.
CREATE UNIQUE INDEX "CallLog_storeId_contentHash_key" ON "CallLog"("storeId", "contentHash");
CREATE INDEX "CallLog_storeId_startedAt_idx" ON "CallLog"("storeId", "startedAt");
CREATE INDEX "CallLog_storeId_userId_startedAt_idx" ON "CallLog"("storeId", "userId", "startedAt");
CREATE INDEX "CallLog_storeId_e164Number_idx" ON "CallLog"("storeId", "e164Number");
CREATE INDEX "CallLog_deviceId_startedAt_idx" ON "CallLog"("deviceId", "startedAt");

-- AddForeignKey
ALTER TABLE "CallSyncDevice" ADD CONSTRAINT "CallSyncDevice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallSyncDevice" ADD CONSTRAINT "CallSyncDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
