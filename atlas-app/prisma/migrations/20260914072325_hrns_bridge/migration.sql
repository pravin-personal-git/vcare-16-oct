-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "hrnsAttendanceId" TEXT,
ADD COLUMN     "hrnsError" TEXT,
ADD COLUMN     "hrnsSyncedAt" TIMESTAMP(3);
