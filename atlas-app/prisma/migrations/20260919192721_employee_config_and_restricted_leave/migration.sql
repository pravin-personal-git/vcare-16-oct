-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "employeeTypeTagId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeTypeTag" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeTypeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTag" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictedLeavePeriod" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "includeAllLeaveTypes" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestrictedLeavePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EmployeeProfileToEmployeeTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EmployeeProfileToEmployeeTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RestrictedPeriodSpecific" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RestrictedPeriodSpecific_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RestrictedPeriodExcluded" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RestrictedPeriodExcluded_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "EmployeeTypeTag_storeId_idx" ON "EmployeeTypeTag"("storeId");

-- CreateIndex
CREATE INDEX "EmployeeTag_storeId_idx" ON "EmployeeTag"("storeId");

-- CreateIndex
CREATE INDEX "RestrictedLeavePeriod_storeId_startDate_endDate_idx" ON "RestrictedLeavePeriod"("storeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "_EmployeeProfileToEmployeeTag_B_index" ON "_EmployeeProfileToEmployeeTag"("B");

-- CreateIndex
CREATE INDEX "_RestrictedPeriodSpecific_B_index" ON "_RestrictedPeriodSpecific"("B");

-- CreateIndex
CREATE INDEX "_RestrictedPeriodExcluded_B_index" ON "_RestrictedPeriodExcluded"("B");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeTypeTagId_fkey" FOREIGN KEY ("employeeTypeTagId") REFERENCES "EmployeeTypeTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTypeTag" ADD CONSTRAINT "EmployeeTypeTag_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTag" ADD CONSTRAINT "EmployeeTag_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedLeavePeriod" ADD CONSTRAINT "RestrictedLeavePeriod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedLeavePeriod" ADD CONSTRAINT "RestrictedLeavePeriod_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EmployeeProfileToEmployeeTag" ADD CONSTRAINT "_EmployeeProfileToEmployeeTag_A_fkey" FOREIGN KEY ("A") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EmployeeProfileToEmployeeTag" ADD CONSTRAINT "_EmployeeProfileToEmployeeTag_B_fkey" FOREIGN KEY ("B") REFERENCES "EmployeeTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RestrictedPeriodSpecific" ADD CONSTRAINT "_RestrictedPeriodSpecific_A_fkey" FOREIGN KEY ("A") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RestrictedPeriodSpecific" ADD CONSTRAINT "_RestrictedPeriodSpecific_B_fkey" FOREIGN KEY ("B") REFERENCES "RestrictedLeavePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RestrictedPeriodExcluded" ADD CONSTRAINT "_RestrictedPeriodExcluded_A_fkey" FOREIGN KEY ("A") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RestrictedPeriodExcluded" ADD CONSTRAINT "_RestrictedPeriodExcluded_B_fkey" FOREIGN KEY ("B") REFERENCES "RestrictedLeavePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
