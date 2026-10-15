-- CreateEnum
CREATE TYPE "PlatformAccountType" AS ENUM ('PLATFORM', 'RESELLER');

-- CreateEnum
CREATE TYPE "AccountLifecycleState" AS ENUM ('PENDING', 'ACTIVE', 'GRACE_PERIOD', 'READ_ONLY', 'SUSPENDED', 'TERMINATED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL,
    "type" "PlatformAccountType" NOT NULL,
    "parentAccountId" TEXT,
    "rootPlatformId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "lifecycleState" "AccountLifecycleState" NOT NULL DEFAULT 'PENDING',
    "billingOwnerAccountId" TEXT,
    "plan" TEXT,
    "licenseType" TEXT,
    "commercialModel" TEXT,
    "subscriptionStatus" TEXT,
    "licenseStatus" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "maxResellerDepth" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_accountCode_key" ON "PlatformAccount"("accountCode");

-- CreateIndex
CREATE INDEX "PlatformAccount_parentAccountId_idx" ON "PlatformAccount"("parentAccountId");

-- CreateIndex
CREATE INDEX "PlatformAccount_rootPlatformId_idx" ON "PlatformAccount"("rootPlatformId");

-- CreateIndex
CREATE INDEX "PlatformAccount_path_idx" ON "PlatformAccount"("path");

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
