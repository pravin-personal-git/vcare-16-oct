-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "shiftId" TEXT,
ADD COLUMN     "workTypeId" TEXT;

-- CreateTable
CREATE TABLE "WorkType" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeShift" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeShiftSchedule" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "minWorkingMinutes" INTEGER NOT NULL DEFAULT 495,
    "isNightShift" BOOLEAN NOT NULL DEFAULT false,
    "autoPunchOutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPunchOutTime" TEXT,

    CONSTRAINT "EmployeeShiftSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkType_storeId_idx" ON "WorkType"("storeId");

-- CreateIndex
CREATE INDEX "EmployeeShift_storeId_idx" ON "EmployeeShift"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeShiftSchedule_shiftId_dayOfWeek_key" ON "EmployeeShiftSchedule"("shiftId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "EmployeeShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "WorkType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkType" ADD CONSTRAINT "WorkType_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShiftSchedule" ADD CONSTRAINT "EmployeeShiftSchedule_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "EmployeeShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
