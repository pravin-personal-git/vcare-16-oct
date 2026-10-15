-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "designationCode" TEXT,
ADD COLUMN     "level" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarColor" TEXT;

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "managerId" TEXT,
    "designationRoleId" TEXT,
    "storeId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMenuConfig" (
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL,

    CONSTRAINT "UserMenuConfig_pkey" PRIMARY KEY ("storeId","userId","menuId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_organizationId_idx" ON "ApiToken"("organizationId");

-- CreateIndex
CREATE INDEX "ReportingAssignment_userId_effectiveFrom_idx" ON "ReportingAssignment"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ReportingAssignment_organizationId_effectiveFrom_idx" ON "ReportingAssignment"("organizationId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingAssignment" ADD CONSTRAINT "ReportingAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingAssignment" ADD CONSTRAINT "ReportingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingAssignment" ADD CONSTRAINT "ReportingAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingAssignment" ADD CONSTRAINT "ReportingAssignment_designationRoleId_fkey" FOREIGN KEY ("designationRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingAssignment" ADD CONSTRAINT "ReportingAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMenuConfig" ADD CONSTRAINT "UserMenuConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMenuConfig" ADD CONSTRAINT "UserMenuConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMenuConfig" ADD CONSTRAINT "UserMenuConfig_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
