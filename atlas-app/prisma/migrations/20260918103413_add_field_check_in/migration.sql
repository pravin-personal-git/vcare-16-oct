-- AlterTable
ALTER TABLE "ServiceVisit" ADD COLUMN     "checkInDistanceM" INTEGER,
ADD COLUMN     "checkInWithinRange" BOOLEAN,
ADD COLUMN     "checkedInAt" TIMESTAMP(3);
