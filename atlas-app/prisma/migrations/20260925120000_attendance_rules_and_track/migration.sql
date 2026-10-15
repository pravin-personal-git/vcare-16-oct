-- MAALIK OS attendance: per-employee clock-in rules, and fake-GPS / speed on
-- each tracking point.

-- AlterTable
ALTER TABLE "AttendanceEvent" ADD COLUMN     "mocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "speedMps" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "EmployeeAttendanceRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allow" TEXT NOT NULL DEFAULT 'store_default',
    "outside" TEXT NOT NULL DEFAULT 'flag',
    "zoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAttendanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAttendanceRule_storeId_userId_key" ON "EmployeeAttendanceRule"("storeId", "userId");

-- AddForeignKey
ALTER TABLE "EmployeeAttendanceRule" ADD CONSTRAINT "EmployeeAttendanceRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

