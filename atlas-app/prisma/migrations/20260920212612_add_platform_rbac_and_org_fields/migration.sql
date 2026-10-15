-- CreateEnum
CREATE TYPE "PlatformRoleScopeType" AS ENUM ('PLATFORM', 'RESELLER', 'TENANT', 'LEGAL_ENTITY');

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingOwnerAccountId" TEXT,
ADD COLUMN     "commercialModel" TEXT,
ADD COLUMN     "contractEnd" TIMESTAMP(3),
ADD COLUMN     "contractStart" TIMESTAMP(3),
ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "licenseStatus" TEXT,
ADD COLUMN     "licenseType" TEXT,
ADD COLUMN     "lifecycleState" "AccountLifecycleState" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "platformAccountId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlatformRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" "PlatformRoleScopeType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRolePermission" (
    "platformRoleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "PlatformRolePermission_pkey" PRIMARY KEY ("platformRoleId","permissionId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platformRoleId" TEXT NOT NULL,
    "platformAccountId" TEXT,
    "organizationId" TEXT,
    "legalEntityId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRole_key_key" ON "PlatformRole"("key");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_platformAccountId_idx" ON "Membership"("platformAccountId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Membership_legalEntityId_idx" ON "Membership"("legalEntityId");

-- CreateIndex
CREATE INDEX "Organization_platformAccountId_idx" ON "Organization"("platformAccountId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRolePermission" ADD CONSTRAINT "PlatformRolePermission_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "PlatformRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRolePermission" ADD CONSTRAINT "PlatformRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "PlatformRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
