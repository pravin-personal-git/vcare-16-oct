-- DropForeignKey
ALTER TABLE "AttendanceEvent" DROP CONSTRAINT "LocationPing_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceSession" DROP CONSTRAINT "Shift_deviceId_fkey";

-- AlterTable
ALTER TABLE "AttendanceEvent" RENAME CONSTRAINT "LocationPing_pkey" TO "AttendanceEvent_pkey";

-- AlterTable
ALTER TABLE "AttendanceSession" RENAME CONSTRAINT "Shift_pkey" TO "AttendanceSession_pkey";

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "siteLat" DECIMAL(9,6),
ADD COLUMN     "siteLng" DECIMAL(9,6),
ADD COLUMN     "siteSource" TEXT;

-- RenameForeignKey
ALTER TABLE "AttendanceEvent" RENAME CONSTRAINT "LocationPing_shiftId_fkey" TO "AttendanceEvent_sessionId_fkey";

-- RenameForeignKey
ALTER TABLE "AttendanceEvent" RENAME CONSTRAINT "LocationPing_storeId_fkey" TO "AttendanceEvent_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "AttendanceEvent" RENAME CONSTRAINT "LocationPing_userId_fkey" TO "AttendanceEvent_userId_fkey";

-- RenameForeignKey
ALTER TABLE "AttendanceSession" RENAME CONSTRAINT "Shift_storeId_fkey" TO "AttendanceSession_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "AttendanceSession" RENAME CONSTRAINT "Shift_userId_fkey" TO "AttendanceSession_userId_fkey";

-- RenameForeignKey
ALTER TABLE "CallLog" RENAME CONSTRAINT "CallLog_shiftId_fkey" TO "CallLog_sessionId_fkey";

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "LocationPing_shiftId_recordedAt_idx" RENAME TO "AttendanceEvent_sessionId_recordedAt_idx";

-- RenameIndex
ALTER INDEX "LocationPing_storeId_userId_recordedAt_idx" RENAME TO "AttendanceEvent_storeId_userId_recordedAt_idx";

-- RenameIndex
ALTER INDEX "Shift_deviceId_endedAt_idx" RENAME TO "AttendanceSession_deviceId_endedAt_idx";

-- RenameIndex
ALTER INDEX "Shift_storeId_startedAt_idx" RENAME TO "AttendanceSession_storeId_startedAt_idx";

-- RenameIndex
ALTER INDEX "Shift_storeId_userId_startedAt_idx" RENAME TO "AttendanceSession_storeId_userId_startedAt_idx";
